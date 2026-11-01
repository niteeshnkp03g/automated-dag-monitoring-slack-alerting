# Automated DAG Monitoring & Slack Alerting System

An automated monitoring and alerting solution built using Google Apps Script, Gmail, and Slack Incoming Webhooks to monitor LMS and RECON DAG execution summaries.

## Project Overview

This project automatically reads DAG summary emails from Gmail, analyzes workflow execution statuses, identifies failures and unexpected statuses, and sends structured notifications to Slack.

The monitoring script executes every 15 minutes using Google Apps Script time-driven triggers.

## Architecture

```text
Gmail
  |
  v
Google Apps Script Trigger
(Every 15 Minutes)
  |
  v
Email Parsing & DAG Status Validation
  |
  v
Status Classification
  |
  +---- SUCCESS
  |
  +---- FAILURE
  |
  +---- DATA ANOMALY
  |
  v
Slack Incoming Webhook
  |
  v
Slack Notifications
```

## Key Features

- Automated Gmail monitoring for DAG summary emails.
- Supports LMS and RECON services.
- Extracts DAG names and execution statuses from HTML email tables.
- Identifies failed DAGs and unexpected execution statuses.
- Sends structured Slack notifications for success, failure, and anomalies.
- Prevents duplicate processing using Gmail message IDs.
- Uses Google Apps Script Properties for processed-message tracking.
- Runs automatically every 15 minutes.
- Logs execution details for troubleshooting.

## Technology Stack

| Component | Technology |
|---|---|
| Automation | Google Apps Script |
| Language | JavaScript |
| Email Integration | GmailApp |
| HTTP Requests | UrlFetchApp |
| Alerting | Slack Incoming Webhooks |
| Scheduling | Time-driven Triggers |
| State Management | PropertiesService |

## Notification Examples

### 1. Successful Execution

![DAG Success](screenshots/dag-success.png)

### 2. Failed DAG Execution

![DAG Failure](screenshots/dag-failure.png)

### 3. Scheduled Trigger

![Trigger Configuration](screenshots/trigger-configuration.png)

## Setup Instructions

1. Open [Google Apps Script](https://script.google.com/).
2. Create a new project.
3. Add the monitoring code from `Code.gs`.
4. Configure the `SLACK_WEBHOOK_URL` Script Property.
5. Configure the Gmail access permissions.
6. Create a time-driven trigger for `checkDagSummary`.
7. Select a 15-minute interval.
8. Test the script using sample DAG summary emails.

## Configuration

The following Script Properties are required:

| Property | Description |
|---|---|
| SLACK_WEBHOOK_URL | Slack Incoming Webhook URL |
| PROCESSED_MESSAGE_IDS | Automatically maintained processed Gmail message IDs |

## Notification Types

| Status | Notification |
|---|---|
| All DAGs successful | Success Alert |
| One or more DAGs failed | Failure Alert |
| Unexpected status detected | Data Anomaly Alert |

## Future Enhancements

- Implement retry mechanisms for failed Slack notifications.
- Add monitoring for Apps Script execution failures.
- Improve Gmail search filtering.
- Add execution metrics and historical reporting.
- Introduce configurable alert thresholds.
- Support additional workflow services.

## Author

Niteesh Kumar Patel

Site Reliability Engineer | Monitoring | Automation | Observability

