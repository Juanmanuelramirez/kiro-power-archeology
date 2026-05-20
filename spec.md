# **Requerimiento Técnico: Kiro Power "Archeology"**

## **1\. Visión General**

**Archeology** es un Power diseñado para el descubrimiento y preservación de la memoria técnica en repositorios legados (Legacy). Su objetivo es reducir el tiempo de navegación en código antiguo mediante el análisis de la intención histórica de los cambios, no solo del estado actual del código.

## **2\. Metadatos del Power (`POWER.md`)**

Markdown

```
---
name: "archeology-oracle"
displayName: "Archeology: Legacy Context Finder"
description: "Descubre el 'por qué' detrás del código antiguo analizando el historial de Git y decisiones técnicas pasadas."
author: "TuNombre/Org"
keywords: ["legacy", "git-history", "code-archaeology", "knowledge-base", "refactoring"]
---
```

## **3\. Requerimientos Funcionales (Core Features)**

### **A. Git-Intent Analysis (Análisis de Intención)**

* **Requerimiento:** El Power debe ser capaz de correlacionar líneas de código específicas con mensajes de commit, PRs (Pull Requests) y discusiones vinculadas.  
* **Acción del Agente:** Cuando el usuario selecciona una función, el Power debe decir: *"Esta función fue modificada por última vez en el PR \#405 para corregir un problema de concurrencia que afectaba a clientes en Europa"*.

### **B. Shadow Debt Detection (Detección de Deuda Fantasma)**

* **Requerimiento:** Identificar archivos con "alta rotación" (churn) pero poca documentación.  
* **Métrica:** Si un archivo ha tenido \>20 contribuidores y no tiene comentarios actualizados en los últimos 6 meses, marcarlo como "Zona de Riesgo Arqueológico".

### **C. The "Oracle" Chat (Contexto Continuo)**

* **Requerimiento:** Permitir preguntas sobre la evolución del sistema.  
  * *Ejemplo de Query:* "¿Cuándo dejamos de usar la librería X y por qué todavía hay referencias a ella en este módulo?"

## **4\. Hooks y Triggers (Integración con el IDE)**

Para que aparezca de forma inteligente en Kiro, debe usar estos hooks:

1. **`on_file_open`**:  
   * Al abrir un archivo con más de 2 años de antigüedad, el Power debe mostrar una pequeña "Ficha de Excavación" con:  
     * Autor original vs. Mantenedor actual.  
     * Última gran refactorización.  
     * Nivel de complejidad ciclomática acumulada.  
2. **`pre_refactor_hook`**:  
   * Si el usuario empieza a borrar código masivamente, el Power debe intervenir: *"Advertencia: Estás eliminando un bloque que soluciona el Edge Case \[ID\_CASO\]. ¿Deseas ver la documentación histórica antes de proceder?"*

## **5\. Arquitectura de Datos (MCP)**

Si decides usar un servidor **MCP (Model Context Protocol)**, el requerimiento de datos es:

* **Input:** Logs de Git, estructura de archivos y archivos de configuración de CI/CD.  
* **Output:** Un grafo de conocimiento que conecte: `Archivo -> Commit -> Autor -> Ticket de Jira (opcional)`.

## **6\. Criterios de Aceptación para el Marketplace**

* **Instalación:** Debe funcionar inmediatamente después de importar la carpeta sin configuraciones manuales de Git complejas.  
* **Privacidad:** El análisis debe ser local (Local-First) para no exponer el historial de código privado a servidores externos, a menos que se use un modelo de lenguaje autorizado por la empresa.

# **Archeology: Legacy & Migration Oracle (Kiro Power)**

## **1\. Metadatos del Marketplace (POWER.md)**

## **name: "archeology-oracle" displayName: "Archeology: Legacy & Migration Oracle" description: "Descubre el 'por qué' detrás del código antiguo y asegura migraciones sin riesgos analizando el contexto histórico de Git." author: "Comunidad Kiro / TuNombre" version: "1.0.0" keywords: \["legacy", "migration", "git-context", "refactoring", "knowledge-mining", "finops-ally"\] icon: "https://api.iconify.design/material-symbols:history-edu.svg"**

## **2\. Visión General**

**Archeology** es un Power de "Inteligencia Histórica". A diferencia de los linters o analizadores estáticos que ven el código como es hoy, Archeology lo ve como un proceso evolutivo. Su valor principal es recuperar la **intención del autor** para facilitar el mantenimiento de sistemas legados y la migración crítica de aplicaciones.

## **3\. Pilares de Valor (Propuesta de Negocio)**

### **A. Soporte a Migraciones Críticas**

Archeology elimina el miedo al "Lift and Shift" ciego:

* **Limpieza de Código Muerto:** Identifica funciones que no han tenido actividad real en años para evitar migrar infraestructura innecesaria.  
* **Mapeo de Dependencias Invisibles:** Revela acoplamientos lógicos basados en el historial de cambios paralelos.  
* **Preservación de Reglas de Oro:** Detecta parches de seguridad o de casos de borde ("edge cases") históricos para que no se pierdan al reescribir código en nuevos lenguajes.

### **B. Arqueología de Código Legado**

* **Git-Intent Correlation:** Vincula bloques de código con mensajes de commit, tickets de Jira y discusiones de PR.  
* **Shadow Debt Detection:** Identifica áreas de alto riesgo basadas en el "Churn" (frecuencia de cambio) y la rotación de desarrolladores.

## **4\. Implementación Técnica (Hooks de Kiro)**

| Hook | Acción del Power |
| ----- | ----- |
| `on_file_open` | Si el archivo tiene \>6 meses de antigüedad, genera un **"Resumen de Excavación"** con el autor principal y el propósito original. |
| `pre_refactor_analysis` | Se activa cuando el usuario intenta borrar o modificar lógica antigua, sugiriendo la revisión de la documentación histórica vinculada. |
| `migration_scout` | Comando manual que genera un reporte de "Preparación para Migración", listando qué partes del código son seguras de mover y cuáles requieren investigación. |

## **5\. Requerimientos de Contexto (MCP)**

Este Power requiere acceso a:

* **Git Provider:** Acceso de lectura a logs y blame.  
* **VCS API (GitHub/GitLab):** Para extraer comentarios de Pull Requests.  
* **Static Analysis Engine:** Para calcular métricas de complejidad comparadas con el tiempo.

## **6\. Sinergia con FinOps**

Archeology se integra nativamente con Powers de optimización de costos:

* **Insight:** *"Este servicio de AWS está sobredimensionado porque se configuró para una campaña de marketing de 2022 que ya terminó (Fuente: Commit \#982)"*.

*Documento de especificación técnica para el proceso de envío al Marketplace de Kiro.*

