const mysql = require('mysql2/promise');
const { WebClient } = require('@slack/web-api');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const formatDateTime = (dateTime) => {
  const opts = {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  };

  const format = new Intl.DateTimeFormat('ko-KR', opts);
  const formattedTime = format.format(new Date(dateTime));

  return formattedTime.replace(/(\d+:\d+)/, '$1분').replace(':', '시 ');
};

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    const connection = await pool.getConnection(async (conn) => conn);

    const now = new Date();
    const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);

    koreaTime.setMinutes(koreaTime.getMinutes() + 15);

    const dateTimeString = koreaTime
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');

    const isStartTimeMatchInDB = (
      await connection.query(
        `SELECT 
          CASE 
            WHEN COUNT(*) > 0 THEN true
            ELSE false
          END AS result
        FROM events
        WHERE start_time = ?;
      `,
        [dateTimeString]
      )
    )[0][0];

    if (isStartTimeMatchInDB.result) {
      const users = (
        await connection.query(
          `SELECT slack_user_id slackUserId FROM events WHERE start_time = ?`,
          [dateTimeString]
        )
      )[0];

      for (const user of users) {
        const userBotToken = (
          await connection.query(
            `SELECT s.bot_token botToken FROM users u JOIN slacks s ON s.team_id = u.slack_team_id WHERE u.slack_user_id = ?`,
            [user.slackUserId]
          )
        )[0][0];

        const eventInfo = (
          await connection.query(
            `SELECT summary, link, start_time startTime, end_time endTime FROM events WHERE slack_user_id = ? AND start_time = ?`,
            [user.slackUserId, dateTimeString]
          )
        )[0][0];

        const userInfo = (
          await connection.query(
            `SELECT slack_channel channel FROM webhooks WHERE slack_user_id = ?`,
            [user.slackUserId]
          )
        )[0][0];

        const web = await new WebClient(userBotToken.botToken);

        const startTime = formatDateTime(eventInfo.startTime);
        const endTime = formatDateTime(eventInfo.endTime);

        const eventOpt = {
          slackChannel: userInfo.channel,
          color: '2FA86B',
          title: '🔔 일정 시작 15분 전 알림',
          summary: `<${eventInfo.link}|*${eventInfo.summary}*>`,
          text: `일정 시작 : ${startTime}\n일정 종료 : ${endTime}`,
        };

        await sendSlackMessage(eventOpt, web);
      }
    }

    return { statusCode: 200 };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.stack }),
    };
  }
};

const sendSlackMessage = async (eventOpt, web) => {
  try {
    const option = {
      channel: eventOpt.slackChannel,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: eventOpt.title,
            emoji: true,
          },
        },
      ],
      attachments: [
        {
          color: eventOpt.color,
          fallback: 'Slack attachment-level `fallback`',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: eventOpt.summary,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: eventOpt.text,
              },
            },
          ],
        },
      ],
    };

    await web.chat.postMessage(option);
  } catch (error) {
    console.error('Slack 메시지 전송 에러 :', error);
  }
};
