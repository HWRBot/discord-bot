const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || '!';
const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'changeme123';

// ─── DATABASE (простой JSON-файл) ─────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'data.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, modlogs: [], commands_used: 0 }));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function addXP(userId, username, amount = 10) {
  const db = loadDB();
  if (!db.users[userId]) {
    db.users[userId] = { id: userId, username, xp: 0, messages: 0, level: 1 };
  }
  db.users[userId].xp += amount;
  db.users[userId].messages += 1;
  db.users[userId].username = username;

  const newLevel = Math.floor(0.1 * Math.sqrt(db.users[userId].xp)) + 1;
  db.users[userId].level = newLevel;

  saveDB(db);
  return db.users[userId];
}

// ─── DISCORD CLIENT ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Бот запущен как ${client.user.tag}`);
  client.user.setActivity('!help | твой сервер', { type: 3 }); // Watching
});

client.on('guildMemberAdd', async (member) => {
  const channel = member.guild.systemChannel;
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('👋 Новый участник!')
    .setDescription(`Добро пожаловать на сервер, ${member}!\nТеперь нас **${member.guild.memberCount}** человек.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  channel.send({ embeds: [embed] });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // XP за сообщения
  addXP(message.author.id, message.author.username, 5);

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const db = loadDB();
  db.commands_used = (db.commands_used || 0) + 1;
  saveDB(db);

  // ─── КОМАНДЫ ───────────────────────────────────────────────────────────────

  // !help
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📚 Список команд')
      .addFields(
        { name: '📋 Общие', value: '`!help` — список команд\n`!info` — информация о сервере\n`!ping` — задержка бота\n`!rank` — твой уровень\n`!top` — топ активных', inline: false },
        { name: '🛡️ Модерация', value: '`!ban @user [причина]` — забанить\n`!kick @user [причина]` — кикнуть\n`!mute @user [минуты]` — замутить\n`!unmute @user` — размутить\n`!clear [число]` — удалить сообщения', inline: false },
      )
      .setFooter({ text: `Префикс: ${PREFIX}` });

    return message.reply({ embeds: [embed] });
  }

  // !ping
  if (command === 'ping') {
    const sent = await message.reply('Измеряю...');
    sent.edit(`🏓 Понг! Задержка: **${Date.now() - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
  }

  // !info
  if (command === 'info') {
    const guild = message.guild;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 ${guild.name}`)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: '👥 Участников', value: `${guild.memberCount}`, inline: true },
        { name: '📅 Создан', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
        { name: '👑 Владелец', value: `<@${guild.ownerId}>`, inline: true },
        { name: '💬 Каналов', value: `${guild.channels.cache.size}`, inline: true },
        { name: '😀 Эмодзи', value: `${guild.emojis.cache.size}`, inline: true },
        { name: '🚀 Буст', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // !rank
  if (command === 'rank') {
    const target = message.mentions.users.first() || message.author;
    const db = loadDB();
    const user = db.users[target.id];

    if (!user) return message.reply('У этого пользователя ещё нет активности.');

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(`⭐ Ранг: ${user.username}`)
      .addFields(
        { name: '🏆 Уровень', value: `${user.level}`, inline: true },
        { name: '✨ XP', value: `${user.xp}`, inline: true },
        { name: '💬 Сообщений', value: `${user.messages}`, inline: true },
      )
      .setThumbnail(target.displayAvatarURL());

    return message.reply({ embeds: [embed] });
  }

  // !top
  if (command === 'top') {
    const db = loadDB();
    const sorted = Object.values(db.users)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

    const list = sorted.map((u, i) => `**${i + 1}.** ${u.username} — Ур. ${u.level} (${u.xp} XP)`).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🏆 Топ участников')
      .setDescription(list || 'Пока никого нет...');

    return message.reply({ embeds: [embed] });
  }

  // ─── МОДЕРАЦИЯ ─────────────────────────────────────────────────────────────

  // !ban
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
      return message.reply('❌ У тебя нет прав на бан.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Укажи пользователя: `!ban @user причина`');

    const reason = args.slice(1).join(' ') || 'Причина не указана';

    try {
      await target.ban({ reason });
      logMod(target.id, target.user.username, message.author.username, 'ban', reason);
      message.reply(`✅ **${target.user.username}** забанен. Причина: ${reason}`);
    } catch {
      message.reply('❌ Не удалось забанить пользователя.');
    }
  }

  // !kick
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return message.reply('❌ У тебя нет прав на кик.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Укажи пользователя: `!kick @user причина`');

    const reason = args.slice(1).join(' ') || 'Причина не указана';

    try {
      await target.kick(reason);
      logMod(target.id, target.user.username, message.author.username, 'kick', reason);
      message.reply(`✅ **${target.user.username}** кикнут. Причина: ${reason}`);
    } catch {
      message.reply('❌ Не удалось кикнуть пользователя.');
    }
  }

  // !mute
  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply('❌ У тебя нет прав на мут.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Укажи пользователя: `!mute @user минуты`');

    const minutes = parseInt(args[1]) || 10;
    const duration = minutes * 60 * 1000;

    try {
      await target.timeout(duration, `Мут на ${minutes} минут`);
      logMod(target.id, target.user.username, message.author.username, 'mute', `${minutes} мин`);
      message.reply(`🔇 **${target.user.username}** замучен на **${minutes} минут**.`);
    } catch {
      message.reply('❌ Не удалось замутить пользователя.');
    }
  }

  // !unmute
  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply('❌ У тебя нет прав.');
    }
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Укажи пользователя.');

    try {
      await target.timeout(null);
      message.reply(`🔊 **${target.user.username}** размучен.`);
    } catch {
      message.reply('❌ Не удалось размутить.');
    }
  }

  // !clear
  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply('❌ У тебя нет прав на удаление сообщений.');
    }
    const amount = Math.min(parseInt(args[0]) || 5, 100);
    try {
      await message.channel.bulkDelete(amount + 1, true);
      const msg = await message.channel.send(`🗑️ Удалено **${amount}** сообщений.`);
      setTimeout(() => msg.delete().catch(() => {}), 3000);
    } catch {
      message.reply('❌ Не удалось удалить сообщения (возможно они старше 14 дней).');
    }
  }
});

function logMod(targetId, targetName, moderatorName, action, reason) {
  const db = loadDB();
  db.modlogs.unshift({
    id: Date.now(),
    targetId,
    targetName,
    moderatorName,
    action,
    reason,
    timestamp: new Date().toISOString(),
  });
  if (db.modlogs.length > 200) db.modlogs = db.modlogs.slice(0, 200);
  saveDB(db);
}

// ─── EXPRESS API ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Middleware: проверка API ключа
function auth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// GET /api/stats — общая статистика
app.get('/api/stats', auth, (req, res) => {
  const db = loadDB();
  const guild = client.guilds.cache.first();

  res.json({
    bot_online: client.isReady(),
    bot_ping: Math.round(client.ws.ping),
    guild_name: guild?.name || 'N/A',
    guild_members: guild?.memberCount || 0,
    total_users_tracked: Object.keys(db.users).length,
    commands_used: db.commands_used || 0,
    mod_actions: db.modlogs.length,
  });
});

// GET /api/leaderboard — топ участников
app.get('/api/leaderboard', auth, (req, res) => {
  const db = loadDB();
  const top = Object.values(db.users)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 20);

  res.json(top);
});

// GET /api/modlogs — лог модерации
app.get('/api/modlogs', auth, (req, res) => {
  const db = loadDB();
  res.json(db.modlogs.slice(0, 50));
});

// POST /api/announce — отправить сообщение в канал
app.post('/api/announce', auth, async (req, res) => {
  const { channel_id, message } = req.body;
  if (!channel_id || !message) return res.status(400).json({ error: 'channel_id and message required' });

  try {
    const channel = await client.channels.fetch(channel_id);
    await channel.send(message);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Healthcheck
app.get('/', (req, res) => res.json({ status: 'ok', bot: client.user?.tag || 'loading...' }));

app.listen(PORT, () => console.log(`🌐 API запущен на порту ${PORT}`));

// ─── ЗАПУСК ───────────────────────────────────────────────────────────────────
client.login(TOKEN);
