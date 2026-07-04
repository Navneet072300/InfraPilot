{{/*
Expand the name of the chart.
*/}}
{{- define "infrapilot-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "infrapilot-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "infrapilot-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "infrapilot-agent.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "infrapilot-agent.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.extraLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
ServiceAccount name
*/}}
{{- define "infrapilot-agent.serviceAccountName" -}}
{{- .Values.serviceAccountName | default "infrapilot-agent" }}
{{- end }}
