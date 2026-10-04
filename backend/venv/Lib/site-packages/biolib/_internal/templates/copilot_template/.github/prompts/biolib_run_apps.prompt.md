---
mode: 'agent'
tools: ['githubRepo', 'codebase', 'fetch']
description: 'Handle running biolib apps, including login, running apps, and managing jobs and results.'
---

# Main task
Your task is to run one or more biolib apps, using the biolib Python API. You can find general instructions [here](https://biolib.com/docs/using-applications/python/)
A few relevant notes:
- You will be running this from inside a biolib app, so login is not necessary.
- Always look at the relevant app's #githubRepo. Ask the user for the repo, and inform them that it needs to be in the format `author/app_name`.
- If you do look at the repo, look at the config.yml to see how it expects inputs to be formatted.
