const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  amount: Number,
  paidAt: Date,
  description: String
});

const serviceSchema = new mongoose.Schema({
  name: String,
  price: Number,
  payments: [paymentSchema]
});

const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  payments: [paymentSchema]
});

const appointmentSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  date: Date,
  duration: Number,
  services: [serviceSchema],
  products: [productSchema]
});

module.exports = mongoose.model('Appointment', appointmentSchema);
