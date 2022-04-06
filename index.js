const {
  default: makeWASocket,
  DisconnectReason,
  AnyMessageContent,
  delay,
  useSingleFileAuthState,
  makeInMemoryStore,
  fetchLatestBaileysVersion,
} = require("@adiwajshing/baileys");
const { Boom } = require("@hapi/boom");
const P = require("pino");

let MAIN_LOGGER = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` });

const logger = MAIN_LOGGER.child({});
logger.level = "trace";

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = makeInMemoryStore({ logger });
store.readFromFile("./baileys_store_multi.json");
// save every 10s
setInterval(() => {
  store.writeToFile("./baileys_store_multi.json");
}, 10_000);

const { state, saveState } = useSingleFileAuthState("./auth_info_multi.json");

/* -------------------------- Extra package include ------------------------- */
const fs = require("fs");
const util = require("util");

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);

let commandsPublic = {};
let commandsMembers = {};
let commandsAdmins = {};
let commandsOwners = {};

const prefix = ".";

require("dotenv").config();
const myNumber = process.env.myNumber;

const addCommands = async () => {
  let path = "./commands/public/";
  let filenames = await readdir(path);
  filenames.forEach((file) => {
    if (file.endsWith(".js")) {
      let { command } = require(path + file);
      let cmdinfo = command(); // {cmd:"", handler:function, alias:[]}
      // console.log(cmdinfo.cmd);
      for (let c of cmdinfo.cmd) {
        commandsPublic[c] = cmdinfo.handler;
      }
    }
  });

  path = "./commands/group/members/";
  filenames = await readdir(path);
  filenames.forEach((file) => {
    if (file.endsWith(".js")) {
      let { command } = require(path + file);
      let cmdinfo = command(); // {cmd:"", handler:function, alias:[]}
      // console.log(cmdinfo.cmd);
      for (let c of cmdinfo.cmd) {
        commandsMembers[c] = cmdinfo.handler;
      }
    }
  });

  // path = "./commands/group/admins/";
  // filenames = await readdir(path);
  // filenames.forEach((file) => {
  //   if (file.endsWith(".js")) {
  //     let { command } = require(path + file);
  //     let cmdinfo = command(); // {cmd:"", handler:function, alias:[]}
  //     // console.log(cmdinfo.cmd);
  //     for (let c of cmdinfo.cmd) {
  //       commandsAdmins[c] = cmdinfo.handler;
  //     }
  //   }
  // });

  // path = "./commands/owner/";
  // filenames = await readdir(path);
  // filenames.forEach((file) => {
  //   if (file.endsWith(".js")) {
  //     let { command } = require(path + file);
  //     let cmdinfo = command(); // {cmd:"", handler:function, alias:[]}
  //     // console.log(cmdinfo.cmd);
  //     for (let c of cmdinfo.cmd) {
  //       commandsOwners[c] = cmdinfo.handler;
  //     }
  //   }
  // });
};

const getGroupAdmins = (participants) => {
  admins = [];
  for (let i of participants) {
    i.isAdmin ? admins.push(i.jid) : "";
  }
  return admins;
};

// start a connection
const startSock = async () => {
  addCommands();
  // fetch latest version of WA Web
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`using WA v${version.join(".")}, isLatest: ${isLatest}`);

  let noLogs = P({ level: "silent" }); //to hide the chat logs
  const sock = makeWASocket({
    version,
    logger: noLogs,
    printQRInTerminal: true,
    auth: state,
    // implement to handle retries
    getMessage: async (key) => {
      return {
        conversation: "hello",
      };
    },
  });

  store.bind(sock.ev);

  const sendMessageWTyping = async (msg, jid) => {
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate("composing", jid);
    await delay(2000);
    await sock.sendPresenceUpdate("paused", jid);
    await sock.sendMessage(jid, msg);
  };

  // sock.ev.on("chats.set", (item) =>
  //   console.log(`recv ${item.chats.length} chats (is latest: ${item.isLatest})`)
  // );
  // sock.ev.on("messages.set", (item) =>
  //   console.log(
  //     `recv ${item.messages.length} messages (is latest: ${item.isLatest})`
  //   )
  // );
  // sock.ev.on("contacts.set", (item) =>
  //   console.log(`recv ${item.contacts.length} contacts`)
  // );

  sock.ev.on("messages.upsert", async (m) => {
    // console.log(JSON.stringify(m, undefined, 2));

    if (!m.messages) return;
    // if (msg.key && msg.key.remoteJid == "status@broadcast") return;

    const msg = JSON.parse(JSON.stringify(m)).messages[0];
    const content = JSON.stringify(msg.message);
    const from = msg.key.remoteJid;
    const type = Object.keys(msg.message)[0];
    const botNumberJid = sock.user.jid;

    //body will have the text message
    let body =
      type === "conversation" && msg.message.conversation.startsWith(prefix)
        ? msg.message.conversation
        : type == "imageMessage" &&
          msg.message.imageMessage.caption &&
          msg.message.imageMessage.caption.startsWith(prefix)
        ? msg.message.imageMessage.caption
        : type == "videoMessage" &&
          msg.message.videoMessage.caption &&
          msg.message.videoMessage.caption.startsWith(prefix)
        ? msg.message.videoMessage.caption
        : type == "extendedTextMessage" &&
          msg.message.extendedTextMessage.text &&
          msg.message.extendedTextMessage.text.startsWith(prefix)
        ? msg.message.extendedTextMessage.text
        : "";

    if (body[1] == " ") body = body[0] + body.slice(2); //remove space when space btw prefix and commandName like "! help"
    const command = body.slice(1).trim().split(/ +/).shift().toLowerCase();
    const args = body.trim().split(/ +/).slice(1);
    const isCmd = body.startsWith(prefix);

    if (!isCmd) return;

    const isGroup = from.endsWith("@g.us");
    const groupMetadata = isGroup ? await sock.groupMetadata(from) : "";
    // console.log(msg);
    let sender = isGroup ? msg.key.participant : from;

    if (msg.key.fromMe) sender = botNumberJid;

    const groupName = isGroup ? groupMetadata.subject : "";
    const groupDesc = isGroup ? groupMetadata.desc : "";
    const groupMembers = isGroup ? groupMetadata.participants : "";
    const groupAdmins = isGroup ? getGroupAdmins(groupMembers) : "";
    const isBotGroupAdmins = groupAdmins.includes(botNumberJid) || false;
    const isGroupAdmins = groupAdmins.includes(sender) || false;

    const isMedia = type === "imageMessage" || type === "videoMessage"; //image or video
    const isTaggedImage =
      type === "extendedTextMessage" && content.includes("imageMessage");
    const isTaggedVideo =
      type === "extendedTextMessage" && content.includes("videoMessage");
    const isTaggedSticker =
      type === "extendedTextMessage" && content.includes("stickerMessage");
    const isTaggedDocument =
      type === "extendedTextMessage" && content.includes("documentMessage");

    // Display every command info
    console.log(
      "[COMMAND]",
      command,
      "[FROM]",
      sender.split("@")[0],
      "[IN]",
      groupName
    );

    //using 'm.messages[0]' to tag message, by giving 'msg' throw some error

    /* ----------------------------- public commands ---------------------------- */
    if (commandsPublic[command]) {
      commandsPublic[command](sock, m.messages[0], from, args, prefix);
      return;
    }

    /* ------------------------- group members commands ------------------------- */
    if (commandsMembers[command]) {
      if (isGroup) {
        commandsMembers[command](sock, m.messages[0], from, args, prefix);
        return;
      }
      await sock.sendMessage(
        from,
        {
          text: "❌ Group command only!",
        },
        { quoted: m.messages[0] }
      );
      return;
    }

    /* -------------------------- group admins commands ------------------------- */
    if (commandsAdmins[command]) {
      if (!isGroupAdmins) {
        commandsAdmins[command](sock, m.messages[0], from, args, prefix);
        return;
      }
      await sock.sendMessage(
        from,
        {
          text: "❌ Admin command!",
        },
        { quoted: m.messages[0] }
      );
      return;
    }

    /* ----------------------------- owner commands ----------------------------- */
    if (commandsOwners[command]) {
      if (myNumber + "@s.whatsapp.net" !== sender) {
        commandsOwners[command](sock, m.messages[0], from, args, prefix);
        return;
      }
      await sock.sendMessage(
        from,
        {
          text: "❌ Owner command only!",
        },
        { quoted: m.messages[0] }
      );
      return;
    }

    /* ----------------------------- unknown command ---------------------------- */
    await sock.sendMessage(
      from,
      {
        text: `Send ${prefix}help for <{PVX}> BOT commands!`,
      },
      { quoted: m.messages[0] }
    );
  });

  // sock.ev.on("messages.update", (m) => console.log(m));
  // sock.ev.on("message-receipt.update", (m) => console.log(m));
  // sock.ev.on("presence.update", (m) => console.log(m));
  // sock.ev.on("chats.update", (m) => console.log(m));
  // sock.ev.on("contacts.upsert", (m) => console.log(m));

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      // reconnect if not logged out
      if (
        (lastDisconnect.error &&
          lastDisconnect.error.output &&
          lastDisconnect.error.output.statusCode) !== DisconnectReason.loggedOut
      ) {
        startSock();
      } else {
        console.log("Connection closed. You are logged out.");
      }
    }

    console.log("connection update", update);
  });
  // listen for when the auth credentials is updated
  sock.ev.on("creds.update", saveState);

  return sock;
};

startSock();
