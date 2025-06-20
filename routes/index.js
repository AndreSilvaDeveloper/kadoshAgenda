const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');

// 🔐 Middleware de proteção
function authMiddleware(req, res, next) {
  if (req.session && req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

// === ROTAS PÚBLICAS ===

// Página de login
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Login POST
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Simples autenticação fixa (substituível por verificação em banco)
  if (username === 'samara' && password === '160793') {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Usuário ou senha inválidos' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// === ROTAS PROTEGIDAS ===

// Buscar cliente
router.get('/search', authMiddleware, async (req, res) => {
  const query = req.query.q?.trim() || "";
  const regex = new RegExp(query, 'i');

  const clients = await Client.find({
    $or: [
      { name: regex },
      { phone: regex }
    ]
  });

  res.render('home', { clients });
});

// Página inicial
router.get('/', authMiddleware, async (req, res) => {
  const clients = await Client.find();
  res.render('home', { clients });
});

// Criar cliente
router.post('/client', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  await Client.create({ name, phone });
  res.redirect('/');
});

// Criar agendamento
router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, services, products } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  await Appointment.create({
    clientId,
    date,
    services: parsedServices,
    products: parsedProducts
  });

  res.redirect(`/client/${clientId}`);
});

// Visualizar cliente e agendamentos
router.get('/client/:id', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const appointments = await Appointment.find({ clientId: client._id });

  let totalService = 0;
  let totalProduct = 0;

  appointments.forEach(appt => {
    totalService += appt.services.reduce((acc, s) => acc + s.price, 0);
    totalProduct += appt.products.reduce((acc, p) => acc + p.price, 0);
  });

  res.render('client', {
    client,
    appointments,
    totalService,
    totalProduct,
    total: totalService + totalProduct
  });
});

// Excluir cliente
router.post('/client/:id/delete', authMiddleware, async (req, res) => {
  await Client.findByIdAndDelete(req.params.id);
  await Appointment.deleteMany({ clientId: req.params.id });
  res.redirect('/');
});

// Remover serviço de agendamento
router.post('/appointment/:id/remove-service/:index', authMiddleware, async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  appt.services.splice(req.params.index, 1);
  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

// Remover produto de agendamento
router.post('/appointment/:id/remove-product/:index', authMiddleware, async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  appt.products.splice(req.params.index, 1);
  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.get('/agendamentos-por-dia', authMiddleware, async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.render('agenda-dia', { date: null, results: [] });
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

const agendamentos = await Appointment.find({
  date: { $gte: start, $lte: end }
}).populate('clientId');

// FILTRA apenas os que têm serviços
const apenasComServicos = agendamentos.filter(a => a.services.length > 0);

res.render('agenda-dia', { date, results: apenasComServicos });

});


module.exports = router;
