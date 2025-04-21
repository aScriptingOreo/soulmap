import express from 'express';
// ... other imports ...
import adminRoutes from './routes/admin.js'; // Import the admin router
// ... other route imports ...

const app = express();

// ... middleware setup (cors, json parsing, etc.) ...

// Mount the admin routes under the /api/admin prefix
app.use('/api/admin', adminRoutes); 

// ... mount other routers ...

// ... error handling and server start logic ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
