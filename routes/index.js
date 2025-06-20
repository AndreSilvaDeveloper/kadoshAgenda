const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Appointment = require('../models/Appointment');
const dayjs = require('dayjs');
require('dayjs/plugin/utc');
require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
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




router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, time, duration, services, products, force } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  // monta início e fim no fuso de SP
  const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
  const dur   = parseInt(duration, 10);
  const end   = new Date(start.getTime() + dur * 60000);

  // *** AQUI você precisa declarar 'conflict' ***
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
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Confirmar Agendamento</title></head>
<body>
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
        input.value = typeof data[key] === 'string'
          ? data[key]
          : JSON.stringify(data[key]);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } else {
      history.back();
    }
  </script>
</body>
</html>
    `);
  }

  // se não houver conflito (ou veio force=true), salva normalmente
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


// ── EDIÇÃO DE CLIENTE ─────────────────────────────────────────────────────────
router.post('/client/:id/edit', async (req, res) => {
  const { name, phone } = req.body;
  await Client.findByIdAndUpdate(req.params.id, { name, phone });
  res.redirect(`/client/${req.params.id}`);
});

// ── EDIÇÃO DE SERVIÇO ─────────────────────────────────────────────────────────
router.post('/appointment/:id/edit-service/:idx', async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  const { name, price } = req.body;
  a.services[req.params.idx].name  = name;
  a.services[req.params.idx].price = parseFloat(price);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});

// ── EDIÇÃO DE PRODUTO ─────────────────────────────────────────────────────────
router.post('/appointment/:id/edit-product/:idx', async (req, res) => {
  const a = await Appointment.findById(req.params.id);
  const { name, price } = req.body;
  a.products[req.params.idx].name  = name;
  a.products[req.params.idx].price = parseFloat(price);
  await a.save();
  res.redirect(`/client/${a.clientId}`);
});



router.get('/financeiro', authMiddleware, async (req, res) => {
  // busca todos os agendamentos com cliente
  const ags = await Appointment.find().populate('clientId');

  // arrays para detalhamento
  const receivedServices  = [];
  const pendingServices   = [];
  const receivedProducts  = [];
  const pendingProducts   = [];

  let totalReceivedServices = 0;
  let totalPendingServices  = 0;
  let totalReceivedProducts = 0;
  let totalPendingProducts  = 0;

  ags.forEach(a => {
    const clientName    = a.clientId.name;
    const apptDateStr   = a.date.toLocaleDateString('pt-BR');
    const apptTimeStr   = a.date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', hour12:false });

    // serviços
    a.services.forEach(s => {
      const paidSum = (s.payments || []).reduce((sum,p)=>sum + (p.amount||0), 0);
      // detalha pagamentos já recebidos
      s.payments.forEach(p => {
        receivedServices.push({
          client: clientName,
          apptOn: `${apptDateStr} ${apptTimeStr}`,
          item: s.name,
          when: new Date(p.paidAt).toLocaleDateString('pt-BR'),
          amount: p.amount,
          desc: p.description || ''
        });
        totalReceivedServices += p.amount;
      });
      // calcula pendente
      const pend = s.price - paidSum;
      if (pend > 0) {
        pendingServices.push({
          client: clientName,
          apptOn: `${apptDateStr} ${apptTimeStr}`,
          item: s.name,
          amount: pend
        });
        totalPendingServices += pend;
      }
    });

    // produtos (mesma lógica)
    a.products.forEach(pdt => {
      const paidSum = (pdt.payments || []).reduce((sum,p)=>sum + (p.amount||0), 0);
      pdt.payments.forEach(p => {
        receivedProducts.push({
          client: clientName,
          apptOn: `${apptDateStr} ${apptTimeStr}`,
          item: pdt.name,
          when: new Date(p.paidAt).toLocaleDateString('pt-BR'),
          amount: p.amount,
          desc: p.description || ''
        });
        totalReceivedProducts += p.amount;
      });
      const pend = pdt.price - paidSum;
      if (pend > 0) {
        pendingProducts.push({
          client: clientName,
          apptOn: `${apptDateStr} ${apptTimeStr}`,
          item: pdt.name,
          amount: pend
        });
        totalPendingProducts += pend;
      }
    });
  });

  res.render('financeiro', {
    receivedServices,  pendingServices,
    receivedProducts,  pendingProducts,
    totalReceivedServices, totalPendingServices,
    totalReceivedProducts, totalPendingProducts
  });
});

module.exports = router;
