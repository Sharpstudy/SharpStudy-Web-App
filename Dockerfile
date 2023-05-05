
# Production stage
# FROM node:14-alpine
# FROM node:14.17.0-alpine3.13
# WORKDIR /app
# COPY package*.json ./
# RUN yarn install --production
# COPY . .
# RUN yarn build
# # COPY --from=build /app/.next ./.next
# # COPY public ./public
# # COPY pages ./pages
# # COPY store ./store
# # COPY email-templates ./email-templates
# # COPY styles ./styles
# # COPY utils ./utils
# EXPOSE 3000
# CMD ["yarn", "start"]

# FROM node:14.17.0-alpine3.13
FROM node:14.21-alpine
WORKDIR /app
COPY package*.json ./
RUN yarn install
COPY . .
# RUN yarn run build
CMD ["yarn", "dev"]
