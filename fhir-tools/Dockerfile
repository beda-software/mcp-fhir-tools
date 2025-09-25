FROM node:lts

RUN apt-get update && apt-get install -y openjdk-17-jdk

WORKDIR /app

COPY package*.json ./

COPY . .

RUN npm install

RUN npm run build

ENV PORT=8000

EXPOSE 8000

CMD ["npm", "run", "start-sse"]