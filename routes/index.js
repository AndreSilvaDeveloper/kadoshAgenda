// routes/index.js
const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

// configura Day.js para lidar com UTC e timezone
dayjs.extend(utc);
dayjs.extend(timezone);

// middleware de autenticação
function authMiddleware(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}

// --- Rotas de Login/Logout ---
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'samara' && password === '160793') {
    req.session.loggedIn = true;
    return res.redirect('/');
  }
  res.render('login', { error: 'Usuário ou senha inválidos' });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Home e Busca de Clientes ---
router.get('/', authMiddleware, async (req, res) => {
  const clients = await Client.find();
  res.render('home', { clients });
});

router.get('/search', authMiddleware, async (req, res) => {
  const q = req.query.q?.trim() || '';
  const regex = new RegExp(q, 'i');
  const clients = await Client.find({
    $or: [{ name: regex }, { phone: regex }]
  });
  res.render('home', { clients });
});

// --- Criar Cliente ---
router.post('/client', authMiddleware, async (req, res) => {
  const { name, phone } = req.body;
  await Client.create({ name, phone });
  res.redirect('/');
});

// --- Criar Agendamento ---
router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, time, duration, services, products, force } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  // monta início no fuso de São Paulo
  const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
  const dur   = parseInt(duration, 10);
  const end   = new Date(start.getTime() + dur * 60000);

  // verifica conflito
  const conflict = await Appointment.findOne({
    date: { $lt: end },
    $expr: {
      $gt: [
        { $add: ['$date', { $multiply: ['$duration', 60000] }] },
        start
      ]
    }
  });

  if (conflict && !force) {
    return res.send(`
      <script>
        if (confirm("⚠️ Já existe outro agendamento nesse horário. Deseja agendar assim mesmo?")) {
          const f = document.createElement('form');
          f.method = 'POST';
          f.action = '/appointment';
          const data = ${JSON.stringify({ clientId, date, time, duration, services, products, force: true })};
          for (const k in data) {
            const i = document.createElement('input');
            i.type = 'hidden';
            i.name = k;
            i.value = typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k]);
            f.appendChild(i);
          }
          document.body.appendChild(f);
          f.submit();
        } else {
          history.back();
        }
      </script>
    `);
  }

  // inicializa pagamentos
  parsedServices.forEach(s => s.payments = []);
  parsedProducts.forEach(p => p.payments = []);

  await Appointment.create({
    clientId,
    date: start,
    duration: dur,
    services: parsedServices,
    products: parsedProducts
  });

  res.redirect(`/client/${clientId}`);
});

// --- Página do Cliente (apenas futuros) ---
router.get('/client/:id', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const all     = await Appointment.find({ clientId: client._id });

  // filtra a partir de hoje (meia-noite SP)
  const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();
  const upcoming = all
    .filter(a => a.date >= midnight)
    .map(a => ({
      ...a.toObject(),
      formatted: dayjs(a.date)
                  .tz('America/Sao_Paulo')
                  .format('DD/MM/YYYY [às] HH:mm')
    }));

  // soma totais
  let totalService = 0, totalProduct = 0, totalPaid = 0;
  upcoming.forEach(a => {
    a.services.forEach(s => {
      totalService += s.price;
      totalPaid    += (s.payments||[]).reduce((sum, p) => sum + (p.amount||0), 0);
    });
    a.products.forEach(p => {
      totalProduct += p.price;
      totalPaid    += (p.payments||[]).reduce((sum, p) => sum + (p.amount||0), 0);
    });
  });

  res.render('client', {
    client,
    appointments: upcoming,
    totalService,
    totalProduct,
    total: totalService + totalProduct,
    totalPaid
  });
});

// --- Histórico (passados) ---
router.get('/client/:id/historico', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);
  const all     = await Appointment.find({ clientId: client._id });
  const midnight = dayjs().tz('America/Sao_Paulo').startOf('day').toDate();

  const past = all
    .filter(a => a.date < midnight)
    .map(a => ({
      ...a.toObject(),
      formatted: dayjs(a.date)
                  .tz('America/Sao_Paulo')
                  .format('DD/MM/YYYY [às] HH:mm')
    }));

  let totalService = 0, totalProduct = 0, totalPaid = 0;
  past.forEach(a => {
    a.services.forEach(s => {
      totalService += s.price;
      totalPaid    += (s.payments||[]).reduce((sum, p) => sum + (p.amount||0), 0);
    });
    a.products.forEach(p => {
      totalProduct += p.price;
      totalPaid    += (p.payments||[]).reduce((sum, p) => sum + (p.amount||0), 0);
    });
  });

  res.render('client', {
    client,
    appointments: past,
    totalService,
    totalProduct,
    total: totalService + totalProduct,
    totalPaid
  });
});

// --- Excluir cliente + agendamentos ---
router.post('/client/:id/delete', authMiddleware, async (req, res) => {
  await Client.findByIdAndDelete(req.params.id);
  await Appointment.deleteMany({ clientId: req.params.id });
  res.redirect('/');
});

// --- Remoções de serviço/produto/pagamento ---
router.post('/appointment/:id/remove-service/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.services.splice(req.params.idx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-product/:idx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.products.splice(req.params.idx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/pay-service/:idx', authMiddleware, async (req, res) => {
  const { amount, description } = req.body;
  const a = await Appointment.findById(req.params.id);
  const val = parseFloat(amount);
  if (isNaN(val) || val <= 0) return res.send("Valor inválido.");
  a.services[req.params.idx].payments.push({ amount: val, paidAt: new Date(), description: description||'' });
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/pay-product/:idx', authMiddleware, async (req, res) => {
  const { amount, description } = req.body;
  const a = await Appointment.findById(req.params.id);
  const val = parseFloat(amount);
  if (isNaN(val) || val <= 0) return res.send("Valor inválido.");
  a.products[req.params.idx].payments.push({ amount: val, paidAt: new Date(), description: description||'' });
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-payment/service/:sIdx/:pIdx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.services[req.params.sIdx].payments.splice(req.params.pIdx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});
router.post('/appointment/:id/remove-payment/product/:pIdx/:ppIdx', authMiddleware, async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  a.products[req.params.pIdx].payments.splice(req.params.ppIdx, 1);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});



// agenda por dia
router.get('/agendamentos-por-dia', authMiddleware, async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.render('agenda-dia', { date: null, results: [] });
  }

  const start = dayjs.tz(`${date}T00:00:00`, 'America/Sao_Paulo').toDate();
  const end   = dayjs.tz(`${date}T23:59:59`, 'America/Sao_Paulo').toDate();

  // busca e popula cliente, já ordenando por date ASC
  const ags = await Appointment.find({
    date: { $gte: start, $lte: end }
  })
  .sort({ date: 1 })            // ← aqui
  .populate('clientId');

  const results = ags
    .filter(a => a.services.length > 0)
    .map(a => ({
      clientId:    a.clientId,
      services:    a.services,
      timeFormatted: dayjs(a.date)
                       .tz('America/Sao_Paulo')
                       .format('HH:mm')
    }));

  res.render('agenda-dia', { date, results });
});


module.exports = router;
