const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');

function authMiddleware(req, res, next) {
  if (req.session && req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'samara' && password === '160793') {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Usuário ou senha inválidos' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

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

router.get('/', authMiddleware, async (req, res) => {
  const clients = await Client.find();
  res.render('home', { clients });
});

router.post('/client', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  await Client.create({ name, phone });
  res.redirect('/');
});

router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, time, duration, services, products, force } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  const localDate = new Date(`${date}T${time}:00-03:00`);
  const start = new Date(localDate);
  const duracao = parseInt(duration);
  const end = new Date(start.getTime() + duracao * 60000);

  const conflito = await Appointment.findOne({
    date: { $lt: end },
    $expr: {
      $gt: [
        { $add: ['$date', { $multiply: ['$duration', 60000] }] },
        start
      ]
    }
  });

  if (conflito && !force) {
    return res.send(`
      <script>
        if (confirm("⚠️ Já existe outro agendamento nesse horário. Deseja agendar assim mesmo?")) {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/appointment';

          const data = ${JSON.stringify({ clientId, date, time, duration, services, products, force: true })};

          for (const key in data) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
            form.appendChild(input);
          }

          window.onload = function () {
            document.body.appendChild(form);
            form.submit();
          };
        } else {
          window.history.back();
        }
      </script>
    `);
  }

  parsedServices.forEach(s => s.payments = []);
  parsedProducts.forEach(p => p.payments = []);

  await Appointment.create({
    clientId,
    date: start,
    duration: duracao,
    services: parsedServices,
    products: parsedProducts
  });

  res.redirect(`/client/${clientId}`);
});

router.get('/client/:id', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const appointments = await Appointment.find({ clientId: client._id });

  let totalService = 0;
  let totalProduct = 0;
  let totalPaid = 0;

  appointments.forEach(appt => {
    appt.services.forEach(s => {
      totalService += s.price;
      totalPaid += (s.payments || []).reduce((sum, p) => sum + p.amount, 0);
    });
    appt.products.forEach(p => {
      totalProduct += p.price;
      totalPaid += (p.payments || []).reduce((sum, p) => sum + p.amount, 0);
    });
  });

  res.render('client', {
    client,
    appointments,
    totalService,
    totalProduct,
    total: totalService + totalProduct,
    totalPaid
  });
});

router.post('/client/:id/delete', authMiddleware, async (req, res) => {
  await Client.findByIdAndDelete(req.params.id);
  await Appointment.deleteMany({ clientId: req.params.id });
  res.redirect('/');
});

router.post('/appointment/:id/remove-service/:index', authMiddleware, async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  appt.services.splice(req.params.index, 1);
  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.post('/appointment/:id/remove-product/:index', authMiddleware, async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  appt.products.splice(req.params.index, 1);
  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.post('/appointment/:id/remove-payment/service/:sIndex/:pIndex', authMiddleware, async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  appt.services[req.params.sIndex].payments.splice(req.params.pIndex, 1);
  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.post('/appointment/:id/remove-payment/product/:pIndex/:ppIndex', authMiddleware, async (req, res) => {
  const appt = await Appointment.findById(req.params.id);
  appt.products[req.params.pIndex].payments.splice(req.params.ppIndex, 1);
  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.post('/appointment/:id/pay-service/:index', authMiddleware, async (req, res) => {
  const { amount, description } = req.body;
  const appt = await Appointment.findById(req.params.id);
  const item = appt.services[req.params.index];

  const valor = parseFloat(amount);
  if (isNaN(valor) || valor <= 0) return res.send("Valor inválido para pagamento.");

  item.payments = item.payments || [];
  item.payments.push({ amount: valor, paidAt: new Date(), description: description || '' });

  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.post('/appointment/:id/pay-product/:index', authMiddleware, async (req, res) => {
  const { amount, description } = req.body;
  const appt = await Appointment.findById(req.params.id);
  const item = appt.products[req.params.index];

  const valor = parseFloat(amount);
  if (isNaN(valor) || valor <= 0) return res.send("Valor inválido para pagamento.");

  item.payments = item.payments || [];
  item.payments.push({ amount: valor, paidAt: new Date(), description: description || '' });

  await appt.save();
  res.redirect(`/client/${appt.clientId}`);
});

router.get('/agendamentos-por-dia', authMiddleware, async (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.render('agenda-dia', { date: null, results: [] });
  }

  const start = new Date(`${date}T00:00:00-03:00`);
  const end = new Date(`${date}T23:59:59-03:00`);

  const agendamentos = await Appointment.find({
    date: { $gte: start, $lte: end }
  }).populate('clientId');

  const apenasComServicos = agendamentos.filter(a => a.services.length > 0);

  res.render('agenda-dia', { date, results: apenasComServicos });
});

module.exports = router;
