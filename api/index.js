const express = require('express');
const serverless = require('serverless-http');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config();

const routes = require('../routes/index');

const app = express();

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("🟢 MongoDB conectado"))
  .catch(err => console.error("🔴 Erro MongoDB:", err));

// Session (em memória – use Redis se crescer)
app.use(session({
  secret: 'salao-kadosh-segredo',
  resave: false,
  saveUninitialized: true
}));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use('/', routes);

// Exporta como função para Vercel
module.exports = app;
module.exports.handler = serverless(app);
