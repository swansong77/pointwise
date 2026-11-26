FROM cypress/included:13.17.0
WORKDIR /e2e
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
ENTRYPOINT ["npx", "cypress", "run"]
