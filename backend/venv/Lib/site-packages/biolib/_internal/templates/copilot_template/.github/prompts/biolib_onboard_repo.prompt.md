---
mode: 'agent'
tools: ['githubRepo', 'codebase']
description: 'Handle onboarding and implementing code from a GitHub repository into a biolib application, with focus on creating easily editable and maintainable code structure.'
---

# Main task
Your task is to help onboard and implement code from a GitHub repository into a biolib application. This involves understanding the repository structure, implementing the core functionality, and ensuring the code is easily editable for future iterations.
Generally, you can do this by adding the repository into an src folder as a submodule, and reading the README.md file to understand how to run the code.
You will then call the relevant functions or classes from the cloned repository in your biolib application

## Key requirements:
- Always ask the user for the GitHub repository if not already provided. Inform them that it needs to be in the format `author/repo_name`.
- Use the #githubRepo tool to examine the repository structure, README, and key files to understand the project.
- Focus on creating code that is easily editable and maintainable, as it's likely the implementation won't be perfect on the first attempt.
- Structure the code in a modular way that allows for easy modifications and improvements.
- Include clear comments for complex logic, but avoid over-commenting obvious code.
- Follow the existing biolib application patterns and conventions.
- Ensure all dependencies are properly specified in requirements.txt with versions locked down.
