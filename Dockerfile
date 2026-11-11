FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY Q /usr/local/bin/Q
RUN chmod +x /usr/local/bin/Q

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
