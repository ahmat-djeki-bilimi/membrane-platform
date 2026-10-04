---
applyTo: '**/*.py'
---

Apply the [general coding guidelines](./style-general.instructions.md) to all code.

# Python-specific code style guidelines
- Use snake_case for function and variable names, and PascalCase for class names.
- Place all imports at the top of the file, grouped in the following order: standard library imports, third-party imports, local application imports. Separate each group with a blank line.
- Limit all lines to a maximum of 120 characters.
- Prefer single quotes for strings unless the string contains a single quote, in which case use double quotes.
- Use blank lines to separate functions, class definitions, and logical sections within functions.
- Use type hints for function arguments and return values where possible.
- Use docstrings to document functions that are used in the main python script, but not elsewhere.
- Avoid using bare except clauses; always specify the exception being caught.
- Use list comprehensions and generator expressions where appropriate for clarity and conciseness.
