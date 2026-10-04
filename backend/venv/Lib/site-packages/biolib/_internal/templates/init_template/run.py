import argparse
import json

from biolib.sdk import Runtime

parser = argparse.ArgumentParser(description='Process some biological sequences.')
parser.add_argument('--input', type=str, required=True, help='Input protein sequences')
args = parser.parse_args()

# update the BioLib result name based on the provided file
Runtime.set_result_name_from_file(args.input)

print(f'Processing input file {args.input}...')

# write an example output file (any file in output/ will be returned to the user)
output_data = {
    'message': 'Hello from BioLib!',
    'results': [
        {'id': 1, 'value': 'Sample result 1'},
        {'id': 2, 'value': 'Sample result 2'},
    ],
}

with open('output/output.json', 'w') as f:
    json.dump(output_data, f, indent=2)
