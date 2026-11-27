// 1) Initialise StackLens FIRST – before any app code is required.
const { stacklens } = require('@stacklens/node-tracer');

stacklens.init({ application: 'orders-api', project: 'storefront' });
// Wrap every function/class exported from ./src/** automatically.
stacklens.autoInstrument({ include: [require('path').join(__dirname, 'src') + require('path').sep] });

// 2) Then load the app.
const express = require('express');
const routes = require('./src/routes');

const app = express();
app.use(stacklens.express()); // entry point: one trace per request
app.use(express.json());
// fake auth: real apps set req.user from a JWT/session – StackLens picks up req.user.id automatically
app.use((req, _res, next) => {
  if (req.headers.authorization) req.user = { id: req.headers.authorization.replace(/^Bearer\s+/i, '') };
  next();
});
app.use('/api', routes);
app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message, traceId: stacklens.currentTraceId() });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`express example on http://localhost:${port}`));
