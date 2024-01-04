
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

# # FROM node:14.17.0-alpine3.13
# FROM node:14.21-alpine
# WORKDIR /app
# COPY package*.json ./
# RUN yarn install
# COPY . .
# # RUN yarn run build
# CMD ["yarn", "dev"]


# # Use Node.js 18 Alpine as the base image
# FROM node:18-alpine AS base

# # Install dependencies only when needed
# FROM base AS deps
# # Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
# RUN apk add --no-cache libc6-compat
# WORKDIR /app

# # Install dependencies based on the preferred package manager
# COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
# RUN \
#   if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
#   elif [ -f package-lock.json ]; then npm ci; \
#   elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
#   else echo "Lockfile not found." && exit 1; \
#   fi

# # Install the mysql2 package
# RUN yarn add mysql2

# # Rebuild the source code only when needed
# FROM base AS builder
# WORKDIR /app
# COPY --from=deps /app/node_modules ./node_modules
# COPY . .

# # Next.js collects completely anonymous telemetry data about general usage.
# # Learn more here: https://nextjs.org/telemetry
# # Uncomment the following line in case you want to disable telemetry during the build.
# # ENV NEXT_TELEMETRY_DISABLED 1

# # Build the Next.js app
# RUN yarn build

# # Production image, copy all the files and run next
# FROM base AS runner
# WORKDIR /app

# # Set the environment variables
# ENV NODE_ENV production
# ENV PORT 3000
# ENV HOSTNAME "0.0.0.0"

# # Create a system group and user for running the app
# RUN addgroup --system --gid 1001 nodejs
# RUN adduser --system --uid 1001 nextjs

# # Install the mysql2 package in the production image
# RUN yarn add mysql2

# # Copy dependencies from the deps stage
# COPY --from=deps /app/node_modules ./node_modules

# # Copy the public directory
# COPY --from=builder /app/public ./public

# # Set the correct permission for the prerender cache
# RUN mkdir .next
# RUN chown nextjs:nodejs .next

# # Automatically leverage output traces to reduce image size
# # https://nextjs.org/docs/advanced-features/output-file-tracing
# COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# USER nextjs

# EXPOSE 3000

# # Start the app
# CMD ["node", "server.js"]




FROM node:18-alpine AS base

# 1. Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Install the mysql2 package
RUN yarn add mysql2


# 2. Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# This will do the trick, use the corresponding env file for each environment.
COPY .env .env.production
RUN yarn build

# 3. Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Install the mysql2 package in the production image
RUN yarn add mysql2

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static


USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME localhost

CMD ["node", "server.js"]