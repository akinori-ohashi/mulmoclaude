# Spreadsheet Authoring Guide

Reference for the `presentSpreadsheet` plugin. Read this before building a spreadsheet.

## Cell Format

Every cell is an object `{"v": value, "f": format}`.

- `v` — value: text, number, date string, or formula (string starting with `=`)
- `f` — optional format code for display

## Formulas

Set `v` to a string starting with `=`. Use Excel-style A1 cell references.

```json
{"v": "=B2*1.05", "f": "$#,##0.00"}
{"v": "=SUM(A1:A10)", "f": "#,##0"}
```

Never pre-calculate — let the spreadsheet compute using cell refs, functions, and arithmetic.

## Available Functions

Only these are available, plus any the workbook defines in its `functions` field. A formula that calls any other function shows an error (such as `#NAME?`) instead of a result.

- Statistical: ANOVA.TEST, AUTOCORREL, AVEDEV, AVERAGE, AVERAGEA, AVERAGEIF, AVERAGEIFS, BETA.DIST, BETA.INV, BETAINV, BINOM.DIST, BINOM.INV, BINOMDIST, CHIDIST, CHIINV, CHISQ.DIST, CHISQ.DIST.RT, CHISQ.INV, CHISQ.INV.RT, CHISQ.TEST, CHITEST, CONFIDENCE.NORM, CONFIDENCE.T, CORREL, COUNT, COUNTA, COUNTBLANK, COUNTIF, COUNTIFS, COVARIANCE.P, COVARIANCE.S, CRITBINOM, DECOMPOSE, DEVSQ, EMA, EXPON.DIST, EXPONDIST, F.DIST, F.DIST.RT, F.INV, F.INV.RT, F.TEST, FDIST, FINV, FISHER, FISHERINV, FORECAST, FORECAST.LINEAR, FREQUENCY, FTEST, GAMMA.DIST, GAMMA.INV, GAMMADIST, GAMMAINV, GAMMALN, GAMMALN.PRECISE, GAUSS, GEOMEAN, GROWTH, HARMEAN, HYPGEOM.DIST, INTERCEPT, KENDALL, KS.TEST, KURT, LARGE, LINEST, LOGEST, LOGINV, LOGNORM.DIST, LOGNORM.INV, MANNWHITNEY.TEST, MAX, MAXA, MAXIFS, MEDIAN, MIN, MINA, MINIFS, MODE, MODE.SNGL, NEGBINOM.DIST, NORM.DIST, NORM.INV, NORM.S.DIST, NORM.S.INV, PEARSON, PERCENTILE, PERCENTILE.EXC, PERCENTILE.INC, PERCENTRANK, PERCENTRANK.EXC, PERCENTRANK.INC, PHI, POISSON, POISSON.DIST, PROB, QUARTILE, QUARTILE.EXC, QUARTILE.INC, RANK, RANK.AVG, RANK.EQ, RSQ, SHAPIRO.TEST, SKEW, SKEW.P, SLOPE, SMALL, SPEARMAN, STANDARDIZE, STDEV, STDEV.P, STDEV.S, STDEVP, STEYX, SUM, SUMIF, SUMIFS, T.DIST, T.DIST.2T, T.DIST.RT, T.INV, T.INV.2T, T.TEST, TREND, TRIMMEAN, TTEST, VAR, VAR.P, VAR.S, VARP, WEIBULL, WEIBULL.DIST, WILCOXON.TEST, Z.TEST, ZTEST
- Mathematical: ABS, CEILING, EXP, FLOOR, INT, LN, LOG, LOG10, MDETERM, MINVERSE, MMULT, MOD, MUNIT, PI, POWER, RAND, RANDARRAY, RANDBETWEEN, ROUND, ROUNDDOWN, ROUNDUP, SEQUENCE, SIGN, SQRT, SUMPRODUCT, TRUNC
- Logical: AND, BYCOL, BYROW, FALSE, IF, IFERROR, IFNA, IFS, LAMBDA, LET, MAP, NOT, OR, REDUCE, TRUE
- Text: CONCAT, CONCATENATE, EXACT, FIND, LEFT, LEN, LOWER, MID, PROPER, REPLACE, RIGHT, SEARCH, SUBSTITUTE, TEXT, TRIM, UPPER, VALUE
- Financial: FV, IPMT, IRR, NPER, NPV, PMT, PPMT, PV, RATE
- Lookup & Reference: CHOOSECOLS, CHOOSEROWS, COLUMN, COLUMNS, DROP, FILTER, GROUPBY, HLOOKUP, HSTACK, INDEX, MATCH, PIVOTBY, ROW, ROWS, SORT, SORTBY, TAKE, TRANSPOSE, UNIQUE, VLOOKUP, VSTACK, XLOOKUP, XMATCH
- Date & Time: DATE, DATEDIF, DAY, DAYS, EDATE, EOMONTH, HOUR, MINUTE, MONTH, NETWORKDAYS, NOW, SECOND, TIME, TODAY, WEEKDAY, WORKDAY, YEAR

## Dates

Use date strings like `01/15/2025` or date formulas like `=TODAY()` or `=DATE(2025,1,15)`. The spreadsheet auto-parses common formats (MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY) into date serial numbers. Date arithmetic works: `=B2-TODAY()` calculates days between dates.

## Format Codes

| Code | Use |
|---|---|
| `$#,##0.00` | Currency |
| `#,##0` | Integer with commas |
| `0.00%` | Percent |
| `0.00` | Decimal |
| `MM/DD/YYYY` | Date |
| `DD-MMM-YYYY` | Date |
| `YYYY-MM-DD` | ISO date |

Format is optional for plain text/numbers.
