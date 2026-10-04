from collections import OrderedDict

from biolib.typing_utils import Any, List


class BioLibTable:
    def __init__(self, columns_to_row_map: OrderedDict, rows: List[Any], title: str):
        self.title = title
        self.rows = rows
        self.columns_to_row_map = columns_to_row_map

    def print_table(self) -> None:
        headers = list(self.columns_to_row_map.keys())
        col_widths = [len(h) for h in headers]

        table_rows: List[List[str]] = []
        for row in self.rows:
            row_values: List[str] = []
            for idx, column in enumerate(self.columns_to_row_map.values()):
                keys = column['key'].split('.')
                value = row[keys[0]]
                for key in keys[1:]:
                    if not value or key not in value:
                        continue
                    value = value[key]
                str_value = str(value)
                row_values.append(str_value)
                col_widths[idx] = max(col_widths[idx], len(str_value))
            table_rows.append(row_values)

        separator = '+' + '+'.join('-' * (w + 2) for w in col_widths) + '+'
        header_row = '|' + '|'.join(f' {h:<{col_widths[i]}} ' for i, h in enumerate(headers)) + '|'

        print(f'\n{self.title}')
        print(separator)
        print(header_row)
        print(separator)
        for row_values in table_rows:
            data_row = '|' + '|'.join(f' {v:<{col_widths[i]}} ' for i, v in enumerate(row_values)) + '|'
            print(data_row)
        print(separator)
