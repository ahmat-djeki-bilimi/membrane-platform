#!/bin/bash
set -e
BIOLIB_REPLACE_GUI_MV_COMMAND
python3 run.py "$@"
