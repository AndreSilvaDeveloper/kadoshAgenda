const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

router.post('/appointment', authMiddleware, async (req, res) => {
  const { clientId, date, time, duration, services, products, force } = req.body;
  const parsedServices = services ? JSON.parse(services) : [];
  const parsedProducts = products ? JSON.parse(products) : [];

  // Usa dayjs para converter data e hora para UTC com base na zona "America/Sao_Paulo"
  const start = dayjs.tz(`${date}T${time}`, 'America/Sao_Paulo').toDate();
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

  // Busca todos os agendamentos do cliente
  const allAppointments = await Appointment.find({ clientId: client._id });

  // Filtra para exibir apenas os agendamentos a partir de hoje (meia-noite)
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const appointments = allAppointments.filter(appt => appt.date >= hoje);

  let totalService = 0;
  let totalProduct = 0;
  let totalPaid = 0;

  appointments.forEach(appt => {
    appt.services.forEach(s => {
      totalService += s.price;
      if (s.payments && s.payments.length > 0) {
        totalPaid += s.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      }
    });
    appt.products.forEach(p => {
      totalProduct += p.price;
      if (p.payments && p.payments.length > 0) {
        totalPaid += p.payments.reduce((sum, pg) => sum + (pg.amount || 0), 0);
      }
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

router.get('/client/:id/historico', authMiddleware, async (req, res) => {
  const client = await Client.findById(req.params.id);

  const allAppointments = await Appointment.find({ clientId: client._id });

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const appointments = allAppointments.filter(appt => appt.date < hoje);

  let totalService = 0;
  let totalProduct = 0;
  let totalPaid = 0;

  appointments.forEach(appt => {
    appt.services.forEach(s => {
      totalService += s.price;
      if (s.payments && s.payments.length > 0) {
        totalPaid += s.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      }
    });
    appt.products.forEach(p => {
      totalProduct += p.price;
      if (p.payments && p.payments.length > 0) {
        totalPaid += p.payments.reduce((sum, pg) => sum + (pg.amount || 0), 0);
      }
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


module.exports = router;
