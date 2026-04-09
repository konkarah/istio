FROM node:20-alpine
WORKDIR /app/service
COPY shared/ /app/shared/
COPY order-service/package.json ./
RUN npm install
COPY order-service/index.js ./
EXPOSE ${PORT:-3000}
CMD ["node", "index.js"]
