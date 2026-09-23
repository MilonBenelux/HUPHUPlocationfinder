require("dotenv").config();
const express = require("express");
const { router: oauthRouter } = require("./routes/oauth");
const workflowActionRouter = require("./routes/workflowAction");

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("GHL nearest-location app is running.");
});

app.use(oauthRouter);
app.use(workflowActionRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
