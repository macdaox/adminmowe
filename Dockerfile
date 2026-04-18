FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

COPY . .

ENV PORT=80

EXPOSE 80

CMD ["npm", "start"]
