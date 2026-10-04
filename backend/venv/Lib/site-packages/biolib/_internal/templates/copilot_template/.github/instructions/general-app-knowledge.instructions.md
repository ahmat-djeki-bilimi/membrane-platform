---
applyTo: "**"
---

You are writing code that runs inside a BioLib app. In general, most BioLib apps are structured such that there is a `run.py` or `main.py` file that contains the main function.
Other files are usually helper files that contain functions that are called from the main function.

BioLib apps often contain a Vite React Typescript project that compiles to a single HTML file used to render interactive and visual output.

BioLib apps run inside a Docker container, which is built from the `Dockerfile` in the root of the app.
