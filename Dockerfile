FROM ubuntu:22.04
WORKDIR /app
COPY . .
EXPOSE 8080
CMD ["bash", "start.sh"]
