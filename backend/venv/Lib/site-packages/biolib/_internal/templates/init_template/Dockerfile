# syntax=docker/dockerfile:1

FROM python:3.13.3-slim
WORKDIR /home/biolib/

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY run.sh .
COPY run.py .

RUN mkdir output
