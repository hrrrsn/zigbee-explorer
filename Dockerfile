FROM node:22.10.0-slim@sha256:e09207f9eca57bc0f93f35f5e252f46ce4c8f86cf2ab4ede5e2a75d1dbc9ae74

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]