import glob
import os
import re
import shutil
import subprocess
import tempfile

import biolib
from biolib.utils import SeqUtil


def natsorted(lst):
    """Sort the list using the natural sort key."""

    def _natural_sort_key(s):
        """A key function for natural sorting."""
        return [int(text) if text.isdigit() else text.lower() for text in re.split('([0-9]+)', s)]

    return sorted(lst, key=_natural_sort_key)


def fasta_above_threshold(fasta_file, work_threshold, work_per_residue=1, verbose=False):
    """True if total FASYA residue work above max_work"""

    records = SeqUtil.parse_fasta(fasta_file)

    # Calculate work units
    total_work_units = 0
    for i, record in enumerate(records):
        sequence_work_units = len(record.sequence) * work_per_residue
        total_work_units += sequence_work_units

        if total_work_units >= work_threshold:
            if verbose:
                print(f'FASTA above threshold (stopped at {total_work_units}) >= {work_threshold}')
                print(f'From  from {i+1}/{len(records)} sequences in {fasta_file}')
            return True

    if verbose:
        print(f'FASTA below threshold ({total_work_units}) < {work_threshold}')
        print(f'From {len(records)} sequences in {fasta_file}')

    return False


def run_locally(command_list, args):
    """Run script locally (no multi-node processing)"""

    # Prepare command
    new_args = vars(args)

    # Delete multinode-specific input arguments
    for k in list(new_args.keys()):
        if str(k).startswith('multinode'):
            del new_args[k]

    # Convert to list format
    new_args_list = _args_dict_to_args_list(new_args)

    # Prepare command, e.g. ["python3", "predict.py"] + new_args_list
    command = command_list + new_args_list

    if args.verbose >= 1:
        print(f'Running {command}')

    # Run command
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode == 0:
        print(f'{result.stdout}')
    else:
        print(f'Error: {result.stderr}')


def fasta_batch_records(records, work_per_batch_min, work_per_residue=1, verbose=False):
    """Converts FASTA records to batches of records, based on thresholds"""

    def log_batches(batches):
        for i, batch in enumerate(batches):
            batch_dict = {
                'records': len(batch),
                'residues': sum(len(record.sequence) for record in batch),
            }

            n_seqs, n_res = batch_dict['records'], batch_dict['residues']
            print(f'Batch {i+1}: {n_res} residues from {n_seqs} sequences')

    batches = []
    batch = []
    current_longest_seq_len = 0
    for record in records:
        seq_len = len(record.sequence)
        potential_longest_seq_len = max(current_longest_seq_len, seq_len)

        # Calculate work units if we were to add this record
        potential_work_units = potential_longest_seq_len * work_per_residue * (len(batch) + 1)

        if potential_work_units >= work_per_batch_min and len(batch) > 0:
            batches.append(batch)
            batch = []
            current_longest_seq_len = 0
            potential_longest_seq_len = seq_len

        # Add to batch
        batch.append(record)
        current_longest_seq_len = potential_longest_seq_len

    # Append last batch if present
    if batch:
        batches.append(batch)

    if verbose:
        log_batches(batches)

    return batches


def fasta_send_batches_biolib(
    app_url, batches, args, args_fasta='fasta', machine='cpu.large', stream_all_jobs=True, verbose=1
):
    """
    Send jobs through pybiolib interface
    """

    if args.verbose >= 1:
        print(f'Sending {len(batches)} batches to Biolib')

    # Login to biolib, prepare app
    # current_app = biolib.load(Runtime.get_app_uri())
    current_app = biolib.load(app_url)  # Nb: uses "_" not "-"

    # Compute results
    job_list = []
    for i, batch_records in enumerate(batches):  # MH
        # Write FASTA, send to server
        with tempfile.TemporaryDirectory() as tempdir:
            # New arguments
            new_args = vars(args)

            # Write batched FASTA to send
            fasta_path = f'{tempdir}/input.fasta'
            SeqUtil.write_records_to_fasta(fasta_path, batch_records)
            new_args[args_fasta] = fasta_path
            new_args['multinode_only_local'] = True

            # Convert to list
            new_args_list = _args_dict_to_args_list(new_args)

            # Send job
            job = current_app.cli(args=new_args_list, blocking=False, machine=machine)
            job_list.append(job)

            # Job stats
            if args.verbose:
                batch_dict = _get_batch_stats(batch_records)
                n_seqs, n_res = batch_dict['records'], batch_dict['residues']
                print(f'Sending job {i+1}: {n_res} residues from {n_seqs} sequences -> arg_list = {new_args_list}')

    # Stream job output at a time
    print('Streaming job outputs ...')
    for i, job in enumerate(job_list):
        # Try to print if verbose. Always on first job, otherwise only if stream_all_jobs set
        if (i == 0 and verbose) or (stream_all_jobs and verbose):
            job.stream_logs()

        # Check if job succeeded
        assert job.get_exit_code() == 0, f'Job failed with exit code {job.get_exit_code()}'

        # Write to disk
        output_dir = f'job_output/job_{i+1}'
        job.save_files(output_dir=output_dir)

        if verbose:
            print(f'Saving to {output_dir}')


def merge_folder(folder_name, job_out_dir='job_output', out_dir='output', verbose=1):
    """Helper function for merging folders"""

    os.makedirs(out_dir, exist_ok=True)

    job_dirs = glob.glob(f'{job_out_dir}/job_*')
    job_dirs = natsorted(job_dirs)

    # Move first file, prepare to merge
    first_folder = f'{job_dirs[0]}/{folder_name}'
    merged_folder = f'{out_dir}/{folder_name}'
    shutil.move(first_folder, merged_folder)

    if verbose:
        print(f'Merging {folder_name} from {len(job_dirs)} directories to {merged_folder}')

    # If more than one folder, merge to first
    if len(job_dirs) >= 2:
        # Find each job output file
        for job_dir in job_dirs[1:]:
            # Move over extra files
            extra_folder = f'{job_dir}/{folder_name}'
            extra_files = os.listdir(extra_folder)
            for file_name in extra_files:
                file_path = f'{extra_folder}/{file_name}'
                shutil.move(file_path, merged_folder)


def merge_file(
    file_name,
    header_lines_int=1,
    job_out_dir='job_output',
    out_dir='output',
    verbose=1,
):
    """Helper function for merging files with headers"""

    os.makedirs(out_dir, exist_ok=True)

    job_dirs = glob.glob(f'{job_out_dir}/job_*')
    job_dirs = natsorted(job_dirs)

    # Move first file, prepare to merge
    first_file = f'{job_dirs[0]}/{file_name}'
    merged_file = f'{out_dir}/{file_name}'
    shutil.move(first_file, merged_file)

    if verbose:
        print(f'Merging {file_name} from {len(job_dirs)} directories to {merged_file}')

    # If more than one file, append to first
    if len(job_dirs) >= 2:
        # Open first file
        with open(merged_file, 'a') as merged_file_handle:
            # Find each job output file
            for job_dir in job_dirs[1:]:
                # Open extra file
                extra_file = f'{job_dir}/{file_name}'
                with open(extra_file) as extra_file_handle:
                    # Skip first n header lines
                    for _ in range(header_lines_int):
                        next(extra_file_handle)

                    # Append content to first file
                    contents = extra_file_handle.read()
                    merged_file_handle.write(contents)


def _get_batch_stats(batch):
    stats_dict = {
        'records': len(batch),
        'residues': sum(len(R.sequence) for R in batch),
    }

    return stats_dict


def _args_dict_to_args_list(new_args):
    """Converts args dict to list of arguments for Biolib"""

    nested_list = [[f'--{key}', f'{value}'] for key, value in new_args.items()]

    arg_list = []
    for lst in nested_list:
        for item in lst:
            arg_list.append(item)

    return arg_list
