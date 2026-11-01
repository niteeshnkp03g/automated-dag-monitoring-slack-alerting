
function checkDagSummary() {

  // ================= CONFIGURATION =================

  const SLACK_WEBHOOK_URL = "Enter you salck webhook"; // Add your Slack Incoming Webhook URL

  const SEARCH_QUERY =
    'newer_than:1d subject:"DAG SUMMARY" -subject:"Summary of failures for Google Apps Script"';

  const MAX_THREADS = 100;
  const MAX_RUNTIME_MS = 4 * 60 * 1000; // 4 minutes
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 500;
  const MAX_STORED_IDS = 250;

  const PROCESSED_KEY = "PROCESSED_MESSAGE_IDS";

  // =================================================

  const startTime = Date.now();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    Logger.log("Another execution is running. Skipping this run.");
    return;
  }

  try {

    if (
      !SLACK_WEBHOOK_URL ||
      !SLACK_WEBHOOK_URL.startsWith("https://hooks.slack.com/")
    ) {
      throw new Error("Please configure a valid Slack webhook URL.");
    }

    const props = PropertiesService.getScriptProperties();

    let processedIds = retryOperation_(
      () => JSON.parse(props.getProperty(PROCESSED_KEY) || "[]"),
      "Read processed IDs",
      MAX_RETRIES,
      BASE_DELAY_MS
    );

    if (!Array.isArray(processedIds)) {
      processedIds = [];
    }

    const processedSet = new Set(processedIds);

    let processedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let stopRun = false;

    // Search only relevant DAG SUMMARY emails.
    const threads = retryOperation_(
      () => GmailApp.search(SEARCH_QUERY, 0, MAX_THREADS),
      "Search Gmail",
      MAX_RETRIES,
      BASE_DELAY_MS
    );

    Logger.log("Threads found: " + threads.length);

    if (threads.length === 0) {
      Logger.log("No matching DAG SUMMARY emails found.");
      return;
    }

    // Batch-fetch messages instead of calling getMessages()
    // separately for every thread.
    const messageGroups = retryOperation_(
      () => GmailApp.getMessagesForThreads(threads),
      "Fetch Gmail messages in batch",
      MAX_RETRIES,
      BASE_DELAY_MS
    );

    // Process messages.
    for (let i = 0; i < messageGroups.length; i++) {

      if (stopRun) break;

      if (Date.now() - startTime >= MAX_RUNTIME_MS) {
        Logger.log(
          "4-minute execution budget reached. Remaining emails " +
          "will be checked in the next scheduled run."
        );
        break;
      }

      const messages = messageGroups[i];

      for (const message of messages) {

        if (Date.now() - startTime >= MAX_RUNTIME_MS) {
          Logger.log("Execution budget reached. Stopping processing.");
          stopRun = true;
          break;
        }

        let messageId;
        let subject;
        let htmlBody;
        let messageDate;

        try {

          messageId = message.getId();

          if (processedSet.has(messageId)) {
            continue;
          }

          subject = message.getSubject();

          // Ignore non-DAG emails and Apps Script failure reports.
          if (
            !subject ||
            !/DAG SUMMARY/i.test(subject) ||
            /Summary of failures for Google Apps Script/i.test(subject)
          ) {
            skippedCount++;
            continue;
          }

          // Ignore other Google Apps Script execution failure reports.
          if (
            /Google Apps Script/i.test(subject) &&
            /failure|error/i.test(subject)
          ) {
            skippedCount++;
            continue;
          }

          htmlBody = message.getBody();
          messageDate = message.getDate();

        } catch (e) {

          Logger.log(
            "Unable to read email: " + errorText_(e)
          );

          failedCount++;

          if (isGoogleServiceError_(e)) {
            stopRun = true;
            break;
          }

          continue;
        }

        let serviceType = "UNKNOWN";

        if (/LMS/i.test(subject)) {
          serviceType = "LMS";
        } else if (/RECON/i.test(subject)) {
          serviceType = "RECON";
        }

        Logger.log("Processing: " + subject);

        // ================= PARSE DAG TABLE =================

        const rows =
          htmlBody.match(/<tr[\s\S]*?<\/tr>/gi) || [];

        let totalDags = 0;

        const failedDags = [];
        const anomalyDags = [];

        rows.forEach(row => {

          const matches = row.match(
            /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
          );

          if (!matches || matches.length < 3) {
            return;
          }

          const cells = matches.map(cell =>
            decodeHtml_(
              cell.replace(/<[^>]*>/g, "").trim()
            )
          );

          const dagName = cells[1];
          const status = (cells[2] || "").toUpperCase();

          // Ignore table header rows and Apps Script report headers.
          if (
            !dagName ||
            [
              "DAG NAME",
              "FUNCTION",
              "DAG",
              "TASK"
            ].includes(dagName.toUpperCase()) ||
            [
              "STATUS",
              "ERROR MESSAGE"
            ].includes(status)
          ) {
            return;
          }

          totalDags++;

          if (
            status === "FAILED" ||
            status.includes("ERROR")
          ) {

            failedDags.push({
              dagName: dagName,
              status: status
            });

          } else if (status !== "SUCCESS") {

            anomalyDags.push({
              dagName: dagName,
              status: status
            });

          }

        });

        // Do not generate a false success alert if no DAG rows
        // could be extracted from the email.
        if (totalDags === 0) {
          Logger.log(
            "No valid DAG records found. Skipping: " + subject
          );
          skippedCount++;
          continue;
        }

        // ==================================================

        const formattedDate = Utilities.formatDate(
          messageDate,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd HH:mm:ss"
        );

        let slackMessage = "";

        // ================= FAILURE ALERT =================

        if (failedDags.length > 0) {

          slackMessage =
            "🚨 *DAG SUMMARY FAILURE ALERT*\n\n" +
            "*Service:* " + serviceType + "\n" +
            "*Subject:* " + subject + "\n" +
            "*Date:* " + formattedDate + "\n\n" +
            "*Total DAGs:* " + totalDags + "\n" +
            "*Failed DAGs:* " + failedDags.length + "\n\n";

          failedDags.forEach(dag => {

            slackMessage +=
              "• " + dag.dagName +
              " → " + dag.status + "\n";

          });

        }

        // ================= DATA ANOMALY =================

        else if (anomalyDags.length > 0) {

          slackMessage =
            "⚠️ *DAG SUMMARY DATA ANOMALY*\n\n" +
            "*Service:* " + serviceType + "\n" +
            "*Subject:* " + subject + "\n" +
            "*Date:* " + formattedDate + "\n\n" +
            "Unexpected status detected.\n\n";

          anomalyDags.forEach(dag => {

            slackMessage +=
              "• " + dag.dagName +
              " → " + dag.status + "\n";

          });

        }

        // ================= SUCCESS ALERT =================

        else {

          slackMessage =
            "✅ *DAG SUMMARY SUCCESS*\n\n" +
            "*Service:* " + serviceType + "\n" +
            "*Subject:* " + subject + "\n" +
            "*Date:* " + formattedDate + "\n\n" +
            "All DAGs completed successfully.\n" +
            "*Total DAGs:* " + totalDags + "\n" +
            "*Failed DAGs:* 0";

        }

        // ================= SEND SLACK =================

        const slackSent = sendSlackWithRetry_(
          SLACK_WEBHOOK_URL,
          slackMessage,
          MAX_RETRIES,
          BASE_DELAY_MS
        );

        if (!slackSent) {

          failedCount++;

          Logger.log(
            "Slack notification failed. Email will be retried: " +
            subject
          );

          continue;
        }

        // ================= SAVE PROCESSED ID =================

        // Add only after successful Slack response.
        const updatedIds = processedIds.concat([messageId]);

        // Retain only the latest 250 message IDs.
        const trimmedIds = updatedIds.slice(-MAX_STORED_IDS);

        try {

          retryOperation_(
            () => props.setProperty(
              PROCESSED_KEY,
              JSON.stringify(trimmedIds)
            ),
            "Save processed message ID",
            MAX_RETRIES,
            BASE_DELAY_MS
          );

          processedIds = trimmedIds;

          processedSet.add(messageId);

          // Keep the in-memory set aligned with persisted IDs.
          if (updatedIds.length > MAX_STORED_IDS) {
            processedSet.clear();
            processedIds.forEach(id => processedSet.add(id));
          }

          processedCount++;

        } catch (e) {

          failedCount++;

          Logger.log(
            "Processed ID could not be saved after Slack accepted " +
            "the notification. Duplicate notification is possible: " +
            errorText_(e)
          );

          stopRun = true;
          break;
        }

        Logger.log(
          "Successfully processed: " + subject +
          " | Service: " + serviceType +
          " | Total DAGs: " + totalDags +
          " | Failed: " + failedDags.length +
          " | Anomalies: " + anomalyDags.length
        );

      }
    }

    Logger.log(
      "Execution completed." +
      " | Successfully processed: " + processedCount +
      " | Failed/deferred: " + failedCount +
      " | Skipped: " + skippedCount +
      " | Duration: " +
      ((Date.now() - startTime) / 1000).toFixed(2) + " seconds"
    );

  } finally {

    lock.releaseLock();

  }

}


// ======================================================
// RETRY GOOGLE SERVICE OPERATIONS
// ======================================================

function retryOperation_(
  operation,
  label,
  maxRetries,
  baseDelayMs
) {

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {

    try {

      return operation();

    } catch (e) {

      lastError = e;

      if (attempt === maxRetries) {
        break;
      }

      const delay =
        baseDelayMs * Math.pow(2, attempt);

      Logger.log(
        label +
        " failed. Attempt " + (attempt + 1) +
        " of " + (maxRetries + 1) +
        ". Error: " + errorText_(e) +
        ". Retrying in " + delay + " ms."
      );

      Utilities.sleep(delay);

    }

  }

  throw new Error(
    label + " failed after retries: " + errorText_(lastError)
  );

}


// ======================================================
// SLACK RETRY HANDLING
// ======================================================

function sendSlackWithRetry_(
  webhookUrl,
  slackMessage,
  maxRetries,
  baseDelayMs
) {

  for (let attempt = 0; attempt <= maxRetries; attempt++) {

    let response;

    try {

      response = UrlFetchApp.fetch(webhookUrl, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          text: slackMessage
        }),
        muteHttpExceptions: true
      });

    } catch (e) {

      if (attempt === maxRetries) {

        Logger.log(
          "Slack network error after retries: " + errorText_(e)
        );

        return false;
      }

      const delay =
        baseDelayMs * Math.pow(2, attempt);

      Logger.log(
        "Slack request failed. Retrying in " +
        delay + " ms. Error: " + errorText_(e)
      );

      Utilities.sleep(delay);

      continue;

    }

    const code = response.getResponseCode();

    // Successful Slack response.
    if (code >= 200 && code < 300) {
      return true;
    }

    // Do not retry permanent client errors.
    if (code !== 429 && code < 500) {

      Logger.log(
        "Slack rejected notification. HTTP: " +
        code +
        " | Response: " +
        response.getContentText()
      );

      return false;
    }

    if (attempt === maxRetries) {

      Logger.log(
        "Slack failed after retries. HTTP: " +
        code +
        " | Response: " +
        response.getContentText()
      );

      return false;
    }

    const delay =
      baseDelayMs * Math.pow(2, attempt);

    Logger.log(
      "Slack returned HTTP " + code +
      ". Retrying in " + delay + " ms."
    );

    Utilities.sleep(delay);

  }

  return false;

}


// ======================================================
// HTML ENTITY DECODING
// ======================================================

function decodeHtml_(value) {

  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();

}


// ======================================================
// GOOGLE SERVICE ERROR IDENTIFICATION
// ======================================================

function isGoogleServiceError_(error) {

  const message = errorText_(error).toLowerCase();

  return (
    message.includes("server error") ||
    message.includes("service error") ||
    message.includes("internal error") ||
    message.includes("temporarily unavailable") ||
    message.includes("service invoked too many times") ||
    message.includes("try again") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("rate limit")
  );

}


// ======================================================
// ERROR HANDLING
// ======================================================

function errorText_(error) {

  return error && error.message
    ? error.message
    : String(error);

}
