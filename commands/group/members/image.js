const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const { downloadContentFromMessage } = require("@adiwajshing/baileys");
const { writeFile } = require("fs/promises");

module.exports.command = () => {
  let cmd = ["image", "toimg"];

  return { cmd, handler };
};

const getRandom = (ext) => {
  return `${Math.floor(Math.random() * 10000)}${ext}`;
};

const handler = async (sock, msg, from, args, msgInfoObj) => {
  let { prefix, isMedia, isTaggedSticker, reply } = msgInfoObj;

  if ((isMedia && !msg.message.stickerMessage.isAnimated) || isTaggedSticker) {
    let downloadFilePath;
    if (msg.message.stickerMessage) {
      downloadFilePath = msg.message.stickerMessage;
    } else {
      downloadFilePath =
        msg.message.extendedTextMessage.contextInfo.quotedMessage
          .stickerMessage;
    }
    const stream = await downloadContentFromMessage(downloadFilePath, "image");
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    const media = getRandom(".jpeg");
    await writeFile(media, buffer);
    ffmpeg(`./${media}`)
      .fromFormat("webp_pipe")
      .save("result.png")
      .on("error", (err) => {
        console.log(err);
        reply(
          "❌ There is some problem!\nOnly non-animated stickers can be convert to image!"
        );
      })
      .on("end", () => {
        sock.sendMessage(
          from,
          {
            image: fs.readFileSync("result.png"),
          },
          {
            mimetype: "image/png",
            quoted: msg,
          }
        );
        try {
          fs.unlinkSync(media);
          fs.unlinkSync("result.png");
        } catch (err) {
          console.log(err);
        }
      });
  } else {
    reply(
      "❌ There is some problem!\nOnly non-animated stickers can be convert to image!"
    );
  }
};
