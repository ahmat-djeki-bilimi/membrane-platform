---
mode: 'agent'
tools: ['codebase', 'fetch']
description: 'Handle changing inputs for a biolib app, by adding, removing or modifying inputs in the config.yml and the python script.'
---

# Main task
Your task is to make sure that all inputs are handled correctly in the give Python script and/or biolib config file.
Read the documentation [here](https://biolib.com/docs/building-applications/syntax-of-config-yml/) to understand how the inputs are handled in the config.yml file.
Inputs in the Python script should be parsed with argparse. If a default is given in the config.yml file, it it is not necessary to set a default in the Python script.
Otherwise, the two files should be consistent.
