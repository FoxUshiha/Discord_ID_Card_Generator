require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder
} = require('discord.js');

const { createCanvas, loadImage } = require('canvas');
const Database = require('better-sqlite3');

// ==========================
// CLIENT
// ==========================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ==========================
// DATABASE
// ==========================
const db = new Database('ids.db');

db.prepare(`
CREATE TABLE IF NOT EXISTS ids (
  nick TEXT PRIMARY KEY,
  rg TEXT,
  nascimento TEXT,
  porte TEXT,
  habilitacao TEXT,
  foto BLOB,
  uuid TEXT,
  expedicao TEXT,
  imagem BLOB
)`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS config (
  guild TEXT PRIMARY KEY,
  role TEXT
)`).run();

// ==========================
// SESSÕES
// ==========================
const sessions = new Map();

// ==========================
// UTILS
// ==========================
function log(e) {
  console.error('[ID-BOT]', e);
}
function r() {
  return Math.floor(100 + Math.random() * 900);
}
function gerarUUID() {
  return `${r()}-${r()}-${r()}`;
}
function hoje() {
  return new Date().toLocaleDateString('pt-BR');
}
function hasPerm(interaction) {
  const cfg = db.prepare('SELECT role FROM config WHERE guild=?')
    .get(interaction.guildId);
  if (!cfg) return false;
  return interaction.member.roles.cache.has(cfg.role);
}

// ==========================
// GERAR IMAGEM
// ==========================
async function gerarImagem(d) {
  const template = await loadImage('./ID.png');
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0);
  const foto = await loadImage(d.foto);
  ctx.drawImage(foto, 104, 32, 481, 477);

  ctx.fillStyle = '#000';
  ctx.font = '46px Arial';
  ctx.fillText(`Nome: ${d.nick}`, 680, 100);
  ctx.fillText(`RG: ${d.rg}`, 680, 200);
  ctx.fillText(`Porte: ${d.porte}`, 680, 300);
  ctx.fillText(`Habilitação: ${d.habilitacao}`, 680, 400);
  ctx.fillText(`Nascimento: ${d.nascimento}`, 680, 500);

  ctx.font = '18px Arial';
  ctx.fillText(`UUID: ${d.uuid}`, 680, 540);

  ctx.font = '18px Arial';
  ctx.fillText(`Expedição: ${d.expedicao}`, 103, 540);

  return canvas.toBuffer('image/png');
}

// ==========================
// COMANDOS
// ==========================
const commands = [
  new SlashCommandBuilder()
    .setName('id-role')
    .setDescription('Definir role autorizada')
    .addRoleOption(o =>
      o.setName('role')
       .setDescription('Role autorizada')
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('id-create')
    .setDescription('Criar documento')
    .addStringOption(o => o.setName('nick').setRequired(true).setDescription('Nick'))
    .addStringOption(o => o.setName('rg').setRequired(true).setDescription('RG'))
    .addStringOption(o => o.setName('porte').setRequired(true).setDescription('Porte'))
    .addStringOption(o => o.setName('habilitacao').setRequired(true).setDescription('Habilitação'))
    .addStringOption(o => o.setName('nascimento').setRequired(true).setDescription('Nascimento'))
    .addBooleanOption(o => o.setName('foto').setRequired(true).setDescription('Enviar foto')),

  new SlashCommandBuilder()
    .setName('id-edit')
    .setDescription('Editar documento')
    .addStringOption(o => o.setName('nick').setRequired(true).setDescription('Nick'))
    .addStringOption(o => o.setName('rg').setDescription('RG'))
    .addStringOption(o => o.setName('porte').setDescription('Porte'))
    .addStringOption(o => o.setName('habilitacao').setDescription('Habilitação'))
    .addStringOption(o => o.setName('nascimento').setDescription('Nascimento'))
    .addBooleanOption(o => o.setName('foto').setDescription('Atualizar foto')),

  new SlashCommandBuilder()
    .setName('id')
    .setDescription('Ver documento')
    .addStringOption(o => o.setName('nick').setRequired(true).setDescription('Nick'))
];

// ==========================
// REGISTER
// ==========================
client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log('✔ Bot online | comandos registrados');
});

// ==========================
// INTERACTIONS
// ==========================
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'id-role') {
      db.prepare(`
        INSERT OR REPLACE INTO config (guild, role)
        VALUES (?, ?)
      `).run(interaction.guildId, interaction.options.getRole('role').id);

      return interaction.reply('Role autorizada definida.');
    }

    if (['id-create', 'id-edit'].includes(interaction.commandName)) {
      if (!hasPerm(interaction))
        return interaction.reply('Você não tem permissão.');
    }

    if (interaction.commandName === 'id-create') {
      sessions.set(interaction.user.id, {
        ...Object.fromEntries(interaction.options.data.map(o => [o.name, o.value])),
        channel: interaction.channelId,
        user: interaction.user.id,
        mode: 'create'
      });
      return interaction.reply('Envie a **IMAGEM** neste chat.');
    }

    if (interaction.commandName === 'id-edit') {
      const nick = interaction.options.getString('nick');
      const row = db.prepare('SELECT * FROM ids WHERE nick=?').get(nick);
      if (!row) return interaction.reply('Documento não encontrado.');

      sessions.set(interaction.user.id, {
        ...row,
        ...Object.fromEntries(interaction.options.data.map(o => [o.name, o.value])),
        channel: interaction.channelId,
        user: interaction.user.id,
        mode: interaction.options.getBoolean('foto') ? 'edit_foto' : 'edit'
      });

      if (interaction.options.getBoolean('foto'))
        return interaction.reply('Envie a **nova FOTO**.');
      else {
        sessions.get(interaction.user.id).foto = row.foto;
        sessions.get(interaction.user.id).uuid = gerarUUID();
        sessions.get(interaction.user.id).expedicao = hoje();
        const img = await gerarImagem(sessions.get(interaction.user.id));
        db.prepare(`INSERT OR REPLACE INTO ids VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(
            nick,
            sessions.get(interaction.user.id).rg,
            sessions.get(interaction.user.id).nascimento,
            sessions.get(interaction.user.id).porte,
            sessions.get(interaction.user.id).habilitacao,
            row.foto,
            sessions.get(interaction.user.id).uuid,
            sessions.get(interaction.user.id).expedicao,
            img
          );
        sessions.delete(interaction.user.id);
        return interaction.reply('Documento atualizado.');
      }
    }

    if (interaction.commandName === 'id') {
      const row = db.prepare('SELECT imagem FROM ids WHERE nick=?')
        .get(interaction.options.getString('nick'));
      if (!row) return interaction.reply('Documento não encontrado.');
      return interaction.reply({ files: [new AttachmentBuilder(row.imagem)] });
    }

  } catch (e) { log(e); }
});

// ==========================
// IMAGEM
// ==========================
client.on('messageCreate', async msg => {
  try {
    const s = sessions.get(msg.author.id);
    if (!s || msg.channelId !== s.channel || !msg.attachments.size) return;

    const att = msg.attachments.first();
    if (!att.contentType?.startsWith('image/')) return;

    const res = await fetch(att.url);
    const arrayBuffer = await res.arrayBuffer();
    s.foto = Buffer.from(arrayBuffer);
    s.uuid = gerarUUID();
    s.expedicao = hoje();

    const img = await gerarImagem(s);

    db.prepare(`INSERT OR REPLACE INTO ids VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(
        s.nick,
        s.rg,
        s.nascimento,
        s.porte,
        s.habilitacao,
        s.foto,
        s.uuid,
        s.expedicao,
        img
      );

    await msg.channel.send({
      content: 'Documento salvo:',
      files: [new AttachmentBuilder(img)]
    });

    sessions.delete(msg.author.id);
  } catch (e) { log(e); }
});

// ==========================
// LOGIN
// ==========================
client.login(process.env.DISCORD_TOKEN);
