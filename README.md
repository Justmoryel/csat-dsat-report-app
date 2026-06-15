# CSAT / DSAT Report Generator

Live app: https://justmoryel.github.io/csat-dsat-report-app/
Browser app for generating CSAT/DSAT reporting dashboards from Survey Details CSV or Excel file.

## Features

- Upload raw Survey Details `.csv`, `.xlsx`, or `.xlsm`
- Generate KPI cards for CSAT, DSAT, NPS, average rating, and turnaround time
- View charts for CSAT/DSAT, daily CSAT trend, rating distribution, and positive drivers
- Review product, user, DSAT case, and negative driver tables
- Download summary and DSAT case CSV exports

## Open The App

This app is built as a static GitHub Pages site.

After GitHub Pages is enabled, open the Pages URL from the repository settings.

## Expected Input

Upload the raw, Survey Details export, not a generated report workbook.

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

## CSAT Calculation

The app uses Tableau-style weighted CSAT scoring:

| Rating | Weight |
| --- | ---: |
| 1 | 20% |
| 2 | 40% |
| 3 | 60% |
| 4 | 80% |
| 5 | 100% |

Formula:

```text
CSAT = average rating weight
```

Example: nine `5` ratings and one `3` rating:

```text
((9 * 100%) + (1 * 60%)) / 10 = 96%
```

## Notes

This app does not store uploaded files. Uploaded data is analyzed in your browser.

Excel parsing uses SheetJS from a CDN:

```html
https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
```
