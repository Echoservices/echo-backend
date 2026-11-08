const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionType } = require('discord.js');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./database.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_key TEXT UNIQUE,
        hwid TEXT,
        expires_at INTEGER,
        created_at INTEGER,
        user_email TEXT,
        user_discord TEXT
    )`);
});

// --- CONFIGURATION ---
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'YOUR_WEBHOOK';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'echo_admin_998877';
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = "1566909604401643541"; 
const CUSTOMER_ROLE_ID = "1568774793321517341"; 
const LOADER_CHANNEL_ID = "1568774711570206841";

// --- LOGGING HELPER ---
async function logToDiscord(action, key, hwid) {
    if (DISCORD_WEBHOOK_URL === 'YOUR_WEBHOOK' || !DISCORD_WEBHOOK_URL) return;
    const payload = {
        embeds: [{
            title: `Echo Auth: ${action}`,
            color: action.includes('Success') ? 5763719 : 15548997,
            fields: [
                { name: 'License Key', value: `\`${key}\``, inline: true },
                { name: 'HWID', value: `\`${hwid}\``, inline: true }
            ],
            timestamp: new Date().toISOString()
        }]
    };
    try {
        const fetch = require('node-fetch');
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {}
}

// --- API ROUTES ---
app.post('/api/auth', (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ error: 'Missing key or HWID' });
    db.get(`SELECT * FROM licenses WHERE license_key = ?`, [key], async (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!row) {
            logToDiscord('Failed (Invalid Key)', key, hwid);
            return res.status(401).json({ error: 'Invalid license key' });
        }
        if (row.expires_at && Date.now() > row.expires_at) {
            logToDiscord('Failed (Expired)', key, hwid);
            return res.status(403).json({ error: 'License expired' });
        }
        if (row.hwid && row.hwid !== hwid) {
            logToDiscord('Failed (HWID Mismatch)', key, hwid);
            return res.status(403).json({ error: 'HWID mismatch' });
        }
        if (!row.hwid) {
            db.run(`UPDATE licenses SET hwid = ? WHERE license_key = ?`, [hwid, key]);
            logToDiscord('Success (New HWID Locked)', key, hwid);
            return res.json({ success: true, message: 'Authenticated' });
        }
        logToDiscord('Success', key, hwid);
        res.json({ success: true, message: 'Authenticated' });
    });
});

// --- DISCORD BOT LOGIC ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
    new SlashCommandBuilder()
        .setName('generate')
        .setDescription('Setup the Echo Key Generation Panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('reset_hwid')
        .setDescription('Reset the HWID of a license key')
        .addStringOption(option => option.setName('key').setDescription('The license key').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('user_info')
        .setDescription('Get info on a license key')
        .addStringOption(option => option.setName('key').setDescription('The license key').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Redeem your license key to access the loader')
        .addStringOption(option => option.setName('key').setDescription('Your license key').setRequired(true)),
    new SlashCommandBuilder()
        .setName('check_gen')
        .setDescription('Check how many keys have been generated')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(command => command.toJSON());

client.once('ready', async () => {
    console.log(`[Discord Bot] Logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('[Discord Bot] Successfully registered GUILD commands.');
    } catch (error) {
        console.error('[Discord Bot] Error registering commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'generate') {
        const embed = new EmbedBuilder()
            .setTitle('Echo Auth | Key Generation')
            .setDescription('Click a button below to generate a new license key.')
            .setColor(0x8b5cf6);

        const btnDay = new ButtonBuilder().setCustomId('gen_1day').setLabel('1 Day').setStyle(ButtonStyle.Secondary);
        const btnMonth = new ButtonBuilder().setCustomId('gen_1month').setLabel('1 Month').setStyle(ButtonStyle.Primary);
        const btnLife = new ButtonBuilder().setCustomId('gen_lifetime').setLabel('Lifetime').setStyle(ButtonStyle.Success);

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btnDay, btnMonth, btnLife)] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('gen_')) {
        let days = 0;
        let durationName = '';

        if (interaction.customId === 'gen_1day') { days = 1; durationName = '1 Day'; }
        if (interaction.customId === 'gen_1month') { days = 30; durationName = '1 Month'; }
        if (interaction.customId === 'gen_lifetime') { days = 0; durationName = 'Lifetime'; }

        const newKey = 'ECHO-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const expiresAt = days > 0 ? Date.now() + (days * 24 * 60 * 60 * 1000) : null;

        db.run(`INSERT INTO licenses (license_key, expires_at, created_at) VALUES (?, ?, ?)`, [newKey, expiresAt, Date.now()], (err) => {
            if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle('✅ Echo Key Generated')
                .setColor(0x8b5cf6)
                .addFields(
                    { name: 'Key', value: `\`${newKey}\``, inline: false },
                    { name: 'Duration', value: durationName, inline: true }
                );

            interaction.reply({ embeds: [embed], ephemeral: true });
        });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'reset_hwid') {
        const key = interaction.options.getString('key');
        db.run(`UPDATE licenses SET hwid = NULL WHERE license_key = ?`, [key], function(err) {
            if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
            if (this.changes === 0) return interaction.reply({ content: '❌ Key not found.', ephemeral: true });
            interaction.reply({ content: `✅ HWID reset for key \`${key}\`.`, ephemeral: true });
        });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'user_info') {
        const key = interaction.options.getString('key');
        db.get(`SELECT * FROM licenses WHERE license_key = ?`, [key], (err, row) => {
            if (err || !row) return interaction.reply({ content: '❌ Key not found.', ephemeral: true });
            const expiryDate = row.expires_at ? new Date(row.expires_at).toLocaleDateString() : 'Lifetime';
            
            const embed = new EmbedBuilder()
                .setTitle('🔍 User Information')
                .setColor(0x8b5cf6)
                .addFields(
                    { name: 'Key', value: `\`${key}\``, inline: false },
                    { name: 'HWID', value: row.hwid ? `\`${row.hwid}\`` : 'Not Set', inline: true },
                    { name: 'Expires', value: expiryDate, inline: true }
                );
            interaction.reply({ embeds: [embed], ephemeral: true });
        });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'redeem') {
        const key = interaction.options.getString('key');
        
        db.get(`SELECT * FROM licenses WHERE license_key = ?`, [key], async (err, row) => {
            if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
            if (!row) return interaction.reply({ content: '❌ Invalid license key.', ephemeral: true });
            if (row.expires_at && Date.now() > row.expires_at) return interaction.reply({ content: '❌ This license has expired.', ephemeral: true });

            try {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                await member.roles.add(CUSTOMER_ROLE_ID);

                const embed = new EmbedBuilder()
                    .setTitle('✅ Redeemed Successfully')
                    .setColor(0x00FF00)
                    .setDescription(`Your license has been verified!\nYou now have the **Customer** role and access to the loader.`);

                const loaderButton = new ButtonBuilder()
                    .setLabel('Go to #loader')
                    .setStyle(ButtonStyle.Link)
                    .setURL(`https://discord.com/channels/${GUILD_ID}/${LOADER_CHANNEL_ID}`);

                await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(loaderButton)], ephemeral: true });
            } catch (roleErr) {
                console.error(roleErr);
                interaction.reply({ content: '❌ Failed to give role. Check bot permissions.', ephemeral: true });
            }
        });
    }

    // --- NEW CHECK_GEN COMMAND ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'check_gen') {
        db.get(`SELECT COUNT(*) AS total FROM licenses`, [], (err, row) => {
            if (err) return interaction.reply({ content: 'Database error.', ephemeral: true });
            
            db.get(`SELECT COUNT(*) AS active FROM licenses WHERE hwid IS NOT NULL`, [], (err2, row2) => {
                const embed = new EmbedBuilder()
                    .setTitle('📊 Generation Stats')
                    .setColor(0x8b5cf6)
                    .addFields(
                        { name: 'Total Keys Generated', value: `**${row.total}**`, inline: true },
                        { name: 'Keys Currently In Use', value: `**${row2.active}**`, inline: true }
                    );

                interaction.reply({ embeds: [embed], ephemeral: true });
            });
        });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Server] Echo Auth running on port ${PORT}`));

if (DISCORD_TOKEN && CLIENT_ID) {
    client.login(DISCORD_TOKEN);
} else {
    console.log("[Discord Bot] Missing Token or Client ID in .env file. Bot will not start.");
}