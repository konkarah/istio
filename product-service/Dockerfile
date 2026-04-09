FROM node:20-alpine
WORKDIR /app/service
COPY shared/ /app/shared/
COPY product-service/package.json ./
RUN npm install
COPY product-service/index.js ./
EXPOSE ${PORT:-3000}
CMD ["node", "index.js"]
