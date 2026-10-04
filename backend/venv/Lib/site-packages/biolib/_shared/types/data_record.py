from .typing import Dict, List, Literal, Optional, TypedDict, Union


class SqliteV1ForeignKey(TypedDict):
    table: str
    column: str


class SqliteV1Column(TypedDict):
    type: Literal['INTEGER', 'REAL', 'TEXT', 'JSON']
    nullable: Optional[bool]
    foreign_key: Optional[SqliteV1ForeignKey]
    json_schema: Optional[Dict]


class SqliteV1Table(TypedDict):
    columns: Dict[str, SqliteV1Column]


class SqliteV1DatabaseSchema(TypedDict):
    tables: Dict[str, SqliteV1Table]


class DataRecordValidationRuleDict(TypedDict):
    path: str
    type: str
    rule: Union[SqliteV1DatabaseSchema]


class DataRecordTypeDict(TypedDict):
    name: str
    validation_rules: List[DataRecordValidationRuleDict]


class DataRecordSlimDict(TypedDict):
    pass


class DataRecordDetailedDict(DataRecordSlimDict):
    type: Optional[DataRecordTypeDict]
