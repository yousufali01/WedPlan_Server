# 💍 WedPlan – Backend API

**Powering the WedPlan Wedding Service Marketplace**

A secure RESTful backend API for managing wedding services, customers, vendors, bookings, authentication, subscriptions, and payments.

---

## 📖 About WedPlan Backend

WedPlan Server is the backend application of the WedPlan Wedding Service Marketplace.

It provides RESTful APIs to support the platform's core functionality, including authentication, role-based authorization, wedding service management, booking operations, vendor management, subscription handling, and secure payment processing.

The backend is developed using **Node.js, Express.js, and MongoDB**, with **Better Auth** for authentication, JWT-based authorization, and **Stripe** for payment processing.

The platform supports three primary user roles:

- Customer
- Vendor
- Admin

## ✨ Key Features

### 🔐 Authentication & Authorization

- Email and password authentication.
- Google OAuth integration.
- Better Auth integration.
- JWT-based API authentication.
- Secure session management.
- Role-based access control.
- Protected API endpoints.
- Server-side user authorization.
- Ownership verification for protected resources.

### 👤 User Management

- User registration and authentication.
- User profile management.
- Customer and vendor role management.
- Retrieve user information.
- Admin user management.
- User access management.

### 🏪 Wedding Service Management

- Create wedding services.
- Retrieve available services.
- Retrieve individual service details.
- Update existing services.
- Delete services.
- Search, filter, and sort services.
- Vendor-specific service management.
- Service image upload using ImgBB.
- Admin service approval system.
- Pending and approved service status management.

### 📅 Booking Management

- Create service booking requests.
- Retrieve customer bookings.
- Retrieve vendor booking requests.
- Accept or reject booking requests.
- Cancel pending bookings.
- Update booking statuses.
- Prevent duplicate bookings.
- Prevent vendors from booking their own services.
- Verify booking ownership and permissions.

**Booking Statuses**

| Status | Description |
|---|---|
| Pending | Booking awaiting vendor response |
| Accepted | Booking accepted by vendor |
| Rejected | Booking rejected by vendor |
| Cancelled | Booking cancelled |

### 💎 Subscription Management

- Free and Premium vendor plans.
- Free vendors can maintain a maximum of 3 active services.
- Premium vendors can maintain unlimited active services.
- Monthly and yearly subscription plans.
- Subscription status management.
- Premium vendor badge support.

### 💳 Payment & Transaction Management

- Stripe Checkout integration.
- Secure payment session creation.
- Stripe webhook integration.
- Webhook signature verification.
- Payment status verification.
- Transaction record management.
- Payment failure and cancellation handling.
- Protection against duplicate payment processing.

### 🛡️ Security & Validation

- JWT verification middleware.
- Role-based authorization middleware.
- Resource ownership validation.
- Protected administrative endpoints.
- Server-side request validation.
- Stripe webhook signature verification.
- Centralized error handling.
- Environment-based configuration.

## 🛠️ Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js 5 | Backend framework |
| MongoDB | NoSQL database |
| Better Auth | Authentication |
| JWT | API authorization |
| JOSE | JWT verification |
| Stripe | Payment processing |
| ImgBB | Image hosting |
| CORS | Cross-origin resource sharing |
| dotenv | Environment configuration |
| Nodemon | Development server |

## 🏗️ Project Structure

```text
WedPlan_Server/
│
├── scripts/
│   ├── create-admin.js
│   └── smoke-test.js
│
├── src/
│   ├── config/
│   │   ├── db.js
│   │   └── indexes.js
│   │
│   ├── (auth)/
│   │   └── auth.js
│   │
│   ├── middleware/
│   ├── routes/
│   └── utils/
│
├── index.js
├── package.json
├── package-lock.json
├── vercel.json
├── .gitignore
└── README.md
```

*Note: This is a simplified overview. Refer to the repository for the complete source structure.*

## ⚙️ Installation & Setup

### Prerequisites

- Node.js
- npm
- MongoDB Atlas account or local MongoDB
- Stripe account for payment testing
- Google Cloud project for Google OAuth

### 1. Clone the Repository

```bash
git clone https://github.com/yousufali01/WedPlan_Server.git
```

### 2. Navigate to the Project

```bash
cd WedPlan_Server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the backend root directory.

```env
# ==========================================
# SERVER CONFIGURATION
# ==========================================
PORT=5000

# ==========================================
# MONGODB CONFIGURATION
# ==========================================
DB_USER=WedPlan
DB_PASSWORD=your_mongodb_password
DB_URI=your_mongodb_connection_uri
DB_NAME=WedPlan

# ==========================================
# BETTER AUTH CONFIGURATION
# ==========================================
BETTER_AUTH_SECRET=your_better_auth_secret
BETTER_AUTH_URL=http://localhost:5000

FRONTEND_URL=http://localhost:3000

# ==========================================
# GOOGLE AUTHENTICATION
# ==========================================
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# ==========================================
# ADMIN CONFIGURATION
# ==========================================
ADMIN_NAME=WedPlan Admin
ADMIN_EMAIL=your_admin_email
ADMIN_PASSWORD=your_admin_password

# ==========================================
# IMAGE UPLOAD
# ==========================================
NEXT_PUBLIC_IMGBB_API_KEY=your_imgbb_api_key

# ==========================================
# STRIPE CONFIGURATION
# ==========================================
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

STRIPE_MONTHLY_PRICE=29
STRIPE_YEARLY_PRICE=290

# ==========================================
# CLIENT URL
# ==========================================
CLIENT_URL=http://localhost:3000
```

For production, configure the deployed URLs:

```env
BETTER_AUTH_URL=https://wedplan-server-seven.vercel.app
FRONTEND_URL=https://wedplan-client-rho.vercel.app
CLIENT_URL=https://wedplan-client-rho.vercel.app
```

### 5. Environment Variables Description

| Variable | Description |
|---|---|
| `PORT` | Backend server port |
| `DB_USER` | MongoDB database username |
| `DB_PASSWORD` | MongoDB database password |
| `DB_URI` | MongoDB connection URI |
| `DB_NAME` | MongoDB database name |
| `BETTER_AUTH_SECRET` | Better Auth secret key |
| `BETTER_AUTH_URL` | Backend authentication URL |
| `FRONTEND_URL` | Frontend application URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ADMIN_NAME` | Default admin name |
| `ADMIN_EMAIL` | Admin account email |
| `ADMIN_PASSWORD` | Admin account password |
| `NEXT_PUBLIC_IMGBB_API_KEY` | ImgBB API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_MONTHLY_PRICE` | Monthly subscription price |
| `STRIPE_YEARLY_PRICE` | Yearly subscription price |
| `CLIENT_URL` | Frontend redirect URL |

**Security:** Replace placeholder values with your own credentials. Never commit `.env` or expose private credentials in GitHub.

### 6. Run the Development Server

```bash
npm run dev
```

The backend will run at:

```text
http://localhost:5000
```

## 📜 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server with Nodemon |
| `npm start` | Start the production server |
| `npm run create-admin` | Run the admin creation script |
| `npm run smoke-test` | Run the backend smoke test |
| `npm test` | Not configured as a test suite yet |

## 🔗 API Modules

The backend provides API functionality for the following modules:

| Module | Main Operations |
|---|---|
| Authentication | Sign up, sign in, session handling |
| Users | User and profile management |
| Services | Create, read, update, delete, search, and approval |
| Bookings | Create, view, update status, and cancel |
| Vendors | Vendor profile and service management |
| Admin | User and service administration |
| Payments | Stripe Checkout and payment verification |
| Subscriptions | Free and Premium plan management |
| Transactions | Payment and transaction records |

Refer to the route files in the repository for the exact endpoint paths and HTTP methods.

## 💳 Stripe Configuration

WedPlan uses Stripe to process vendor subscription payments.

Setup:

1. Create a Stripe account.
2. Enable Test Mode.
3. Get your API keys from the Stripe Dashboard.
4. Add the Secret Key and Publishable Key to the backend environment.
5. Configure the webhook endpoint.
6. Add the webhook signing secret to `STRIPE_WEBHOOK_SECRET`.
7. Test successful, failed, and cancelled payment flows.

**Important:** Premium subscription activation must depend on verified server-side payment events. Do not activate a subscription only because the frontend redirects to a success page.

## 🔑 Google OAuth Configuration

Google authentication uses Google OAuth credentials.

1. Open Google Cloud Console.
2. Create or select a project.
3. Configure the OAuth consent screen.
4. Create OAuth 2.0 Client Credentials.
5. Configure the required authorized origins and redirect URLs.
6. Add the Client ID and Client Secret to the backend environment variables.

## 🖼️ ImgBB Configuration

WedPlan uses ImgBB for image hosting.

1. Create an ImgBB account.
2. Generate an API key.
3. Configure the key in the environment where the upload request is implemented.
4. Test image uploads and verify the returned image URL.

## 🚀 Deployment

The WedPlan backend is deployed on Vercel.

**Live Backend:**

https://wedplan-server-seven.vercel.app

Before deployment:

- Configure all backend environment variables in Vercel.
- Verify MongoDB connection and database access.
- Configure production frontend URLs.
- Configure Google OAuth redirect URLs.
- Configure Stripe webhook endpoint and signing secret.
- Verify CORS configuration.
- Test authentication, services, bookings, and subscriptions after deployment.

## 🔒 Security Guidelines

- Never commit `.env` files.
- Never expose database credentials or private API keys.
- Keep secrets in deployment environment settings.
- Verify authentication tokens on the server.
- Apply role-based authorization to protected routes.
- Validate resource ownership before updating or deleting resources.
- Verify Stripe webhook signatures.
- Validate all important payment events on the backend.

## 🌐 Project Links

- **Live Website:** https://wedplan-client-rho.vercel.app
- **Live Backend:** https://wedplan-server-seven.vercel.app
- **Frontend Repository:** https://github.com/yousufali01/WedPlan_Client
- **Backend Repository:** https://github.com/yousufali01/WedPlan_Server

## 👨‍💻 Developer

**WedPlan – Wedding Service Marketplace**

Backend developed using Node.js, Express.js, MongoDB, Better Auth, JWT, and Stripe.

---

<p align="center">
  <strong>WedPlan – Making Every Wedding Special. ❤️</strong>
</p>
