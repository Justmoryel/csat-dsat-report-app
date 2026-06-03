# CSAT / DSAT Report Generator

Local web app for generating CSAT/DSAT reporting dashboards from Survey Details CSV or Excel files.

## Features

- Upload raw Survey Details `.csv`, `.xlsx`, or `.xlsm`
- Generate KPI cards for CSAT, DSAT, NPS, average rating, and turnaround time
- View charts for CSAT/DSAT, daily CSAT trend, rating distribution, and positive drivers
- Review product, user, DSAT case, and negative driver tables
- Download summary and DSAT case CSV exports

## Run Locally

Install dependencies:

```powershell
npm install
```

Start the app:

```powershell
npm start
```

Open:

```text
http://localhost:4173
```

## Expected Input

Upload the raw Survey Details export, not a generated report workbook.

Required columns:

- `SURVEY_CASE`
- `QUESTION_GROUP`
- `How would you rate the quality of the work we completed?`

Recommended columns:

- `SURVEY_CASE_STATUS_DATE`
- `CASE_CREATE_DATE`
- `Day Date`
- `CASE_ID`
- `PRODUCT_NAME`
- `CASE_COMPLETE_USER`
- `BRAND`
- `Response Text/Comment`
- `RESPONSE`
- `RESPONSE_TEXT`

## Notes

This app is intended to run locally. It does not store uploaded files; uploaded data is analyzed in memory and returned to the browser.
