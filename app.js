// monitor.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

let isActive = true;
let downtimeEmailSent = false;

const downtimeRecipients = ['marian9508@gmail.com'];
const alertRecipients = ['marian9508@gmail.com'];
const errorRecipients = ['marian9508@gmail.com'];

const FILE_PATH = path.resolve(__dirname, 'CanceledGoals.txt');

// SMTP setup
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'randd2244@gmail.com',
    pass: 'skqe kytr oaxd cxyh'
  }
});

function getAdjustedUnixTimestamp() {
  const nowMs = Date.now();
  const adjusted = nowMs + 8 * 3600 * 1000 - 15 * 1000;
  return Math.floor(adjusted / 1000);
}

async function sendEmail(to, subject, body) {
  try {
    await transporter.sendMail({
      from: '"ScoreMonitor" <randd2244@gmail.com>',
      to: to.join(','),
      subject,
      text: body
    });
    console.log(`✉️  Email sent: "${subject}"`);
  } catch (err) {
    console.error('❌  Failed to send email:', err);
  }
}

async function executeLogic() {
  const mt = getAdjustedUnixTimestamp();
  const pageUrl = 'https://lv.scoremer.com/';
  const apiPath = `ajax/score/data`;

  console.log(new Date().toISOString(), '→ loading page to catch', apiPath);

  let browser;
  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();

    // 1) wait for the exact AJAX response
    const responsePromise = page.waitForResponse(response =>
      response.url().endsWith(apiPath) && response.status() === 200
    );

    // 2) go to the page that issues that request
    await page.goto(pageUrl, { waitUntil: 'networkidle2' });

    // 3) once intercepted, grab its text
    const apiResponse = await responsePromise;
    const text = await apiResponse.text();

    // 4) downtime logic
    if (!text) {
      console.warn('⚠️  No data returned from AJAX');
      if (isActive) {
        isActive = false;
        if (!downtimeEmailSent) {
          await sendEmail(
            downtimeRecipients,
            'API is Down',
            `The AJAX endpoint returned empty at ${new Date().toLocaleString()}. Retrying every 60s.`
          );
          downtimeEmailSent = true;
        }
      }
      return;
    }

    // 5) recovered?
    if (!isActive) {
      isActive = true;
      downtimeEmailSent = false;
      console.log('✅  AJAX recovered; resuming 10s polling');
    }

    // ── UPDATED PARSING BLOCK ───────────────────────────────────────
    // payload is { matches: […], mt: '…' }
    const payload = JSON.parse(text);
    if (!payload.rs || !Array.isArray(payload.rs)) {
      throw new Error('Expected payload.matches to be an array');
    }
    const matches = payload.rs;
    console.log(`🕹  Retrieved ${matches.length} matches via network interception`);
    // ────────────────────────────────────────────────────────────────

    // 7) load existing records
    const existing = fs.existsSync(FILE_PATH)
      ? fs.readFileSync(FILE_PATH, 'utf-8').split(/\r?\n/)
      : [];

    const newLines = [];

    // 8) scan each match’s events_graph.events for canceled goals
    for (const m of matches) {
      const evs = m.events_graph?.events;
      if (!Array.isArray(evs)) continue;

      for (const e of evs) {
      //  console.log(e,"evss")
        if (e.t === 'ggc' || e.t === 'hgc') {
          const recId = `${m.id}_${e.status}`;
          if (!existing.some(r => r.includes(recId))) {
            console.log(`${e.content}  Goal Canceled @${e.status} -- NEW`);
            newLines.push(
              `UnID - ${recId} ::: Match Id - ${m.id} ::: ${e.content} Goal Canceled @${e.status}`
            );
          } else {
            console.log(`${e.content}  Goal Canceled @${e.status} -- OLD`);
          }
        }
      }
    }

    // 9) append & email if there are new lines
    if (newLines.length) {
      fs.appendFileSync(FILE_PATH, newLines.join('\n') + '\n', 'utf-8');
      await sendEmail(alertRecipients, 'Goal Canceled', newLines.join('\n'));
    } else {
      console.log('👍  No new canceled goals');
    }

  } catch (err) {
    console.error('❌  executeLogic error:', err);
    await sendEmail(
      errorRecipients,
      'Error Occurred in executeLogic',
      `An error occurred at ${new Date().toLocaleString()}:\n\n${err.stack}`
    );
  } finally {
    if (browser) await browser.close();
  }
}

// self-scheduling so interval adapts to up/down
async function scheduler() {
  await executeLogic();
  const delay = isActive ? 10_000 : 60_000;
  setTimeout(scheduler, delay);
}

// kick it off
scheduler();
