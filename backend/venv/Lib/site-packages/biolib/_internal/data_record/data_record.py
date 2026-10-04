import sqlite3
from pathlib import Path

from biolib._shared.types import SqliteV1DatabaseSchema


def get_actual_schema(db_path):
    if not db_path.exists():
        raise Exception(f'File {db_path} not found.')
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()

    actual_schema: SqliteV1DatabaseSchema = {'tables': {}}
    for table in tables:
        table_name = table[0]
        cursor.execute(f'PRAGMA table_info({table_name});')
        columns = cursor.fetchall()
        actual_schema['tables'][table_name] = {'columns': {}}
        for column in columns:
            actual_schema['tables'][table_name]['columns'][column[1]] = {
                'type': column[2],
                'nullable': not bool(column[3]),
            }

        cursor.execute(f'PRAGMA foreign_key_list({table_name});')
        foreign_keys = cursor.fetchall()
        for fk in foreign_keys:
            actual_schema['tables'][table_name]['columns'][fk[3]]['foreign_key'] = {'table': fk[2], 'column': fk[4]}

    conn.close()
    return actual_schema


def verify_schema(specification: SqliteV1DatabaseSchema, actual_schema: SqliteV1DatabaseSchema):
    for table_name, table_spec in specification['tables'].items():
        if table_name not in actual_schema['tables']:
            raise Exception(f"Error: Table '{table_name}' is missing.")

        for column_name, column_spec in table_spec['columns'].items():
            if column_name not in actual_schema['tables'][table_name]['columns']:
                raise Exception(f"Error: Column '{column_name}' in table '{table_name}' is missing.")

            actual_column = actual_schema['tables'][table_name]['columns'][column_name]
            if actual_column['type'] != column_spec['type']:
                raise Exception(
                    f"Error: Column '{column_name}' in table '{table_name}' "
                    "has type '{actual_column['type']}' but expected '{column_spec['type']}'."
                )

            if not actual_column['nullable'] and column_spec.get('nullable', True):
                raise Exception(
                    f"Error: Column '{column_name}' in table '{table_name}' is "
                    'not nullable but should be nullable according to the specification.'
                )

        for column_name, column_spec in table_spec['columns'].items():
            if column_spec.get('foreign_key'):
                foreign_key_spec = column_spec['foreign_key']
                if actual_schema['tables'][table_name]['columns'][column_name].get('foreign_key'):
                    fk = actual_schema['tables'][table_name]['columns'][column_name]['foreign_key']
                    if (
                        fk
                        and foreign_key_spec
                        and fk['table'] == foreign_key_spec['table']
                        and fk['column'] == foreign_key_spec['column']
                    ):
                        raise Exception(
                            f"Error: Column '{column_name}' in table '{table_name}' does "
                            'not have the correct foreign key constraint.'
                        )
                else:
                    raise Exception(
                        f"Error: Column '{column_name}' in table '{table_name}' does "
                        'not have a foreign key constraint.'
                    )


def validate_sqlite_v1(schema: SqliteV1DatabaseSchema, sqlite_file: Path):
    actual_schema = get_actual_schema(sqlite_file)
    print(schema)
    print(actual_schema)
    verify_schema(specification=schema, actual_schema=actual_schema)
