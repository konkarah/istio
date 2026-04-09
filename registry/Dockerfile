FROM node:20-alpine
WORKDIR /app/service
COPY shared/ /app/shared/
COPY registry/package.json ./
RUN npm install
COPY registry/index.js ./
EXPOSE ${PORT:-3000}
CMD ["node", "index.js"]
