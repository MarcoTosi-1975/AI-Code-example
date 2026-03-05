using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace JsonCleaner
{
    /// <summary>
    /// Operatori per i filtri condizionali
    /// </summary>
    public enum FilterOperator
    {
        Equals,
        NotEquals,
        GreaterThan,
        LessThan,
        GreaterThanOrEqual,
        LessThanOrEqual,
        Contains,
        StartsWith,
        EndsWith
    }

    /// <summary>
    /// Classe per definire un filtro condizionale
    /// </summary>
    public class PropertyFilter
    {
        public string Property { get; set; }
        public string Operator { get; set; }
        public object Value { get; set; }

        public FilterOperator GetOperator()
        {
            if (Enum.TryParse<FilterOperator>(Operator, true, out var op))
                return op;
            return FilterOperator.Equals;
        }
    }

    /// <summary>
    /// Classe per la rimozione ricorsiva di oggetti/array da file JSON
    /// Compatibile con TestStand di National Instruments
    /// Thread-safe e con gestione memoria ottimizzata
    /// Versione 1.1 - Sintassi filtri semplificata
    /// </summary>
    public class JsonCleanerTool : IDisposable
    {
        private StringBuilder _logBuilder;
        private bool _enableLogging;
        private bool _disposed = false;
        private const int MAX_LOG_SIZE = 1048576; // 1MB max log size
        private const int MAX_RECURSION_DEPTH = 100;

        public JsonCleanerTool()
        {
            _logBuilder = new StringBuilder(4096);
            _enableLogging = false;
        }

        /// <summary>
        /// Rimuove ricorsivamente un oggetto o array da un file JSON
        /// </summary>
        public bool RemoveJsonElement(
            string inputFilePath, 
            string targetToRemove, 
            string outputFilePath, 
            out int removedCount,
            out string logOutput,
            bool enableLogging = false)
        {
            ThrowIfDisposed();
            ResetLog(enableLogging);
            
            removedCount = 0;
            logOutput = string.Empty;

            try
            {
                Log($"[START] RemoveJsonElement");
                Log($"Input file: {inputFilePath}");
                Log($"Output file: {outputFilePath}");

                if (!File.Exists(inputFilePath))
                {
                    Log($"[ERROR] File di input non trovato!");
                    logOutput = GetLog();
                    return false;
                }

                string jsonContent = File.ReadAllText(inputFilePath);
                Log($"File letto, lunghezza: {jsonContent.Length} caratteri");

                JToken rootToken = JToken.Parse(jsonContent);
                Log($"JSON parsato correttamente, tipo: {rootToken.Type}");

                JToken targetToken = JToken.Parse(targetToRemove);
                Log($"Target parsato, tipo: {targetToken.Type}");

                removedCount = RemoveRecursive(rootToken, targetToken, 0);
                Log($"Rimozione completata, elementi rimossi: {removedCount}");

                string outputJson = rootToken.ToString(Formatting.Indented);
                File.WriteAllText(outputFilePath, outputJson);
                Log($"[SUCCESS] File di output scritto");

                logOutput = GetLog();
                return true;
            }
            catch (Exception ex)
            {
                Log($"[EXCEPTION] {ex.GetType().Name}: {ex.Message}");
                logOutput = GetLog();
                return false;
            }
            finally
            {
                CleanupAfterOperation();
            }
        }

        /// <summary>
        /// Rimuove elementi in base al contenuto (valore)
        /// </summary>
        public bool RemoveJsonElementFromString(
            string inputJson, 
            string targetToRemove, 
            out string outputJson, 
            out int removedCount,
            out string logOutput,
            bool enableLogging = false)
        {
            ThrowIfDisposed();
            ResetLog(enableLogging);
            
            removedCount = 0;
            outputJson = string.Empty;
            logOutput = string.Empty;

            try
            {
                Log($"[START] RemoveJsonElementFromString");

                if (string.IsNullOrEmpty(inputJson))
                {
                    Log($"[ERROR] Input JSON è null o vuoto!");
                    logOutput = GetLog();
                    return false;
                }

                JToken rootToken = JToken.Parse(inputJson);
                JToken targetToken = JToken.Parse(targetToRemove);

                removedCount = RemoveRecursive(rootToken, targetToken, 0);
                Log($"Rimozione completata, elementi rimossi: {removedCount}");

                outputJson = rootToken.ToString(Formatting.Indented);
                Log($"[SUCCESS] Operazione completata");
                
                logOutput = GetLog();
                return true;
            }
            catch (Exception ex)
            {
                Log($"[EXCEPTION] {ex.GetType().Name}: {ex.Message}");
                logOutput = GetLog();
                return false;
            }
            finally
            {
                CleanupAfterOperation();
            }
        }

        /// <summary>
        /// Rimuove ricorsivamente una proprietà specifica per nome con filtri opzionali
        /// NUOVO v1.1: Supporta sintassi semplificata filtersString (es. "Occurred Equals true")
        /// </summary>
        /// <param name="inputJson">JSON di input</param>
        /// <param name="propertyName">Nome della proprietà da rimuovere</param>
        /// <param name="outputJson">JSON di output</param>
        /// <param name="removedCount">Numero di proprietà rimosse</param>
        /// <param name="skippedCount">Numero di proprietà skippate per filtri</param>
        /// <param name="logOutput">Log dettagliato</param>
        /// <param name="filtersJson">JSON array di filtri (vecchio formato, opzionale)</param>
        /// <param name="filtersString">Stringa filtri semplificata (es. "Occurred Equals true; Code GreaterThan 0")</param>
        /// <param name="enableLogging">Abilita logging</param>
        /// <returns>True se successo</returns>
        public bool RemovePropertyByName(
            string inputJson, 
            string propertyName, 
            out string outputJson, 
            out int removedCount,
            out int skippedCount,
            out string logOutput,
            string filtersJson = null,
            string filtersString = null,
            bool enableLogging = false)
        {
            ThrowIfDisposed();
            ResetLog(enableLogging);
            
            removedCount = 0;
            skippedCount = 0;
            outputJson = string.Empty;
            logOutput = string.Empty;

            try
            {
                Log($"[START] RemovePropertyByName");
                Log($"Property name: '{propertyName}'");

                if (string.IsNullOrEmpty(inputJson))
                {
                    Log($"[ERROR] Input JSON è null o vuoto!");
                    logOutput = GetLog();
                    return false;
                }

                if (string.IsNullOrEmpty(propertyName))
                {
                    Log($"[ERROR] Property name è null o vuoto!");
                    logOutput = GetLog();
                    return false;
                }

                // Parse filtri - priorità a filtersString se presente
                List<PropertyFilter> filters = null;
                
                if (!string.IsNullOrEmpty(filtersString))
                {
                    Log($"Parsing filtersString: '{filtersString}'");
                    filters = ParseFiltersString(filtersString);
                    if (filters == null)
                    {
                        Log($"[ERROR] Errore nel parsing di filtersString!");
                        logOutput = GetLog();
                        return false;
                    }
                    Log($"Filtri parsati da stringa: {filters.Count}");
                }
                else if (!string.IsNullOrEmpty(filtersJson))
                {
                    Log($"Parsing filtersJson (vecchio formato)");
                    filters = JsonConvert.DeserializeObject<List<PropertyFilter>>(filtersJson);
                    Log($"Filtri parsati da JSON: {filters?.Count ?? 0}");
                }

                if (filters != null && filters.Count > 0)
                {
                    foreach (var f in filters)
                    {
                        Log($"  - Filtro: {f.Property} {f.Operator} {f.Value}");
                    }
                }
                else
                {
                    Log($"Nessun filtro attivo - rimuovi tutto");
                }

                JToken rootToken = JToken.Parse(inputJson);
                Log($"JSON parsato correttamente");

                RemovePropertyRecursive(rootToken, propertyName, filters, ref removedCount, ref skippedCount, 0);
                
                Log($"Operazione completata:");
                Log($"  - Rimosse: {removedCount}");
                Log($"  - Skippate: {skippedCount}");

                outputJson = rootToken.ToString(Formatting.Indented);
                Log($"[SUCCESS]");
                
                logOutput = GetLog();
                return true;
            }
            catch (Exception ex)
            {
                Log($"[EXCEPTION] {ex.GetType().Name}: {ex.Message}");
                Log($"StackTrace: {ex.StackTrace}");
                logOutput = GetLog();
                return false;
            }
            finally
            {
                CleanupAfterOperation();
            }
        }

        /// <summary>
        /// Metodo per verificare la validità del JSON
        /// </summary>
        public bool IsValidJson(string json, out string errorMessage)
        {
            ThrowIfDisposed();
            errorMessage = string.Empty;
            
            try
            {
                JToken.Parse(json);
                return true;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
        }

        /// <summary>
        /// NUOVO v1.1: Parsa la stringa filtri in formato semplificato
        /// Format: "PropertyName Operator Value" oppure multipli separati da ";"
        /// Esempi: "Occurred Equals true" oppure "Occurred Equals true; Code GreaterThan 0"
        /// </summary>
        private List<PropertyFilter> ParseFiltersString(string filtersString)
        {
            try
            {
                var filters = new List<PropertyFilter>();
                
                // Split per filtri multipli (separati da punto e virgola)
                var filterParts = filtersString.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
                
                foreach (var filterPart in filterParts)
                {
                    var trimmed = filterPart.Trim();
                    if (string.IsNullOrEmpty(trimmed))
                        continue;
                    
                    // Pattern: PropertyName Operator Value
                    // Supporta valori tra apici singoli o doppi: 'value' o "value"
                    var match = Regex.Match(trimmed, 
                        @"^(\w+)\s+(Equals|NotEquals|GreaterThan|LessThan|GreaterThanOrEqual|LessThanOrEqual|Contains|StartsWith|EndsWith)\s+(.+)$",
                        RegexOptions.IgnoreCase);
                    
                    if (!match.Success)
                    {
                        Log($"[WARNING] Filtro non valido: '{trimmed}'");
                        continue;
                    }
                    
                    string property = match.Groups[1].Value.Trim();
                    string operatorStr = match.Groups[2].Value.Trim();
                    string valueStr = match.Groups[3].Value.Trim();
                    
                    // Parse del valore
                    object value = ParseFilterValue(valueStr);
                    
                    var filter = new PropertyFilter
                    {
                        Property = property,
                        Operator = operatorStr,
                        Value = value
                    };
                    
                    filters.Add(filter);
                    Log($"Filtro parsato: {property} {operatorStr} {value} (tipo: {value?.GetType().Name})");
                }
                
                return filters;
            }
            catch (Exception ex)
            {
                Log($"[ERROR] Errore nel parsing filtersString: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Parsa il valore del filtro dalla stringa
        /// Supporta: true/false, numeri, stringhe (con o senza apici)
        /// </summary>
        private object ParseFilterValue(string valueStr)
        {
            // Rimuovi apici se presenti
            if ((valueStr.StartsWith("'") && valueStr.EndsWith("'")) ||
                (valueStr.StartsWith("\"") && valueStr.EndsWith("\"")))
            {
                return valueStr.Substring(1, valueStr.Length - 2);
            }
            
            // Boolean
            if (valueStr.Equals("true", StringComparison.OrdinalIgnoreCase))
                return true;
            if (valueStr.Equals("false", StringComparison.OrdinalIgnoreCase))
                return false;
            
            // Null
            if (valueStr.Equals("null", StringComparison.OrdinalIgnoreCase))
                return null;
            
            // Numero (int o double)
            if (int.TryParse(valueStr, out int intValue))
                return intValue;
            if (double.TryParse(valueStr, System.Globalization.NumberStyles.Any, 
                System.Globalization.CultureInfo.InvariantCulture, out double doubleValue))
                return doubleValue;
            
            // Stringa senza apici
            return valueStr;
        }

        /// <summary>
        /// Rimozione ricorsiva con protezione stack overflow
        /// </summary>
        private int RemoveRecursive(JToken currentToken, JToken targetToken, int depth)
        {
            if (depth > MAX_RECURSION_DEPTH)
            {
                Log($"[WARNING] Max recursion depth reached ({MAX_RECURSION_DEPTH})");
                return 0;
            }

            int count = 0;

            if (currentToken is JContainer container)
            {
                var toRemove = new List<JToken>(container.Count / 4);

                foreach (JToken child in container.Children())
                {
                    if (child is JProperty property)
                    {
                        if (JToken.DeepEquals(property.Value, targetToken))
                        {
                            Log($"Match: {property.Name}");
                            toRemove.Add(property);
                            count++;
                        }
                        else
                        {
                            count += RemoveRecursive(property.Value, targetToken, depth + 1);
                        }
                    }
                    else if (child is JArray || child is JObject)
                    {
                        if (JToken.DeepEquals(child, targetToken))
                        {
                            Log($"Match: {child.Type}");
                            toRemove.Add(child);
                            count++;
                        }
                        else
                        {
                            count += RemoveRecursive(child, targetToken, depth + 1);
                        }
                    }
                    else
                    {
                        if (JToken.DeepEquals(child, targetToken))
                        {
                            toRemove.Add(child);
                            count++;
                        }
                    }
                }

                foreach (var item in toRemove)
                {
                    item.Remove();
                }
                
                toRemove.Clear();
            }

            return count;
        }

        /// <summary>
        /// Rimozione ricorsiva di proprietà per nome con filtri
        /// </summary>
        private void RemovePropertyRecursive(
            JToken token, 
            string propertyName, 
            List<PropertyFilter> filters,
            ref int removedCount,
            ref int skippedCount,
            int depth)
        {
            if (depth > MAX_RECURSION_DEPTH)
            {
                Log($"[WARNING] Max recursion depth reached");
                return;
            }

            if (token is JObject obj)
            {
                var toRemove = new List<JProperty>();
                
                foreach (JProperty property in obj.Properties().ToList())
                {
                    if (property.Name == propertyName)
                    {
                        if (filters != null && filters.Count > 0)
                        {
                            bool shouldSkip = CheckFilters(property.Value, filters);
                            
                            if (shouldSkip)
                            {
                                Log($"Skip: {property.Name}");
                                skippedCount++;
                            }
                            else
                            {
                                toRemove.Add(property);
                                removedCount++;
                            }
                        }
                        else
                        {
                            toRemove.Add(property);
                            removedCount++;
                        }
                    }
                    else
                    {
                        RemovePropertyRecursive(property.Value, propertyName, filters, 
                            ref removedCount, ref skippedCount, depth + 1);
                    }
                }
                
                foreach (var prop in toRemove)
                {
                    prop.Remove();
                }
                
                toRemove.Clear();
            }
            else if (token is JArray array)
            {
                foreach (var item in array)
                {
                    RemovePropertyRecursive(item, propertyName, filters, 
                        ref removedCount, ref skippedCount, depth + 1);
                }
            }
        }

        /// <summary>
        /// Verifica filtri
        /// </summary>
        private bool CheckFilters(JToken valueToken, List<PropertyFilter> filters)
        {
            if (filters == null || filters.Count == 0)
                return false;

            if (!(valueToken is JObject obj))
                return false;

            foreach (var filter in filters)
            {
                JToken propertyValue = obj[filter.Property];
                
                if (propertyValue == null)
                    return false;

                if (EvaluateFilter(propertyValue, filter))
                    return true;
            }

            return false;
        }

        /// <summary>
        /// Valuta un singolo filtro
        /// </summary>
        private bool EvaluateFilter(JToken propertyValue, PropertyFilter filter)
        {
            FilterOperator op = filter.GetOperator();

            try
            {
                switch (propertyValue.Type)
                {
                    case JTokenType.Boolean:
                        return EvaluateBooleanFilter(propertyValue.Value<bool>(), filter.Value, op);
                    
                    case JTokenType.Integer:
                    case JTokenType.Float:
                        return EvaluateNumericFilter(propertyValue.Value<double>(), filter.Value, op);
                    
                    case JTokenType.String:
                        return EvaluateStringFilter(propertyValue.Value<string>(), filter.Value?.ToString(), op);
                    
                    case JTokenType.Null:
                        return filter.Value == null && op == FilterOperator.Equals;
                    
                    default:
                        return false;
                }
            }
            catch
            {
                return false;
            }
        }

        private bool EvaluateBooleanFilter(bool value, object filterValue, FilterOperator op)
        {
            bool target = Convert.ToBoolean(filterValue);
            
            switch (op)
            {
                case FilterOperator.Equals:
                    return value == target;
                case FilterOperator.NotEquals:
                    return value != target;
                default:
                    return false;
            }
        }

        private bool EvaluateNumericFilter(double value, object filterValue, FilterOperator op)
        {
            double target = Convert.ToDouble(filterValue);
            
            switch (op)
            {
                case FilterOperator.Equals:
                    return Math.Abs(value - target) < 0.0001;
                case FilterOperator.NotEquals:
                    return Math.Abs(value - target) >= 0.0001;
                case FilterOperator.GreaterThan:
                    return value > target;
                case FilterOperator.LessThan:
                    return value < target;
                case FilterOperator.GreaterThanOrEqual:
                    return value >= target;
                case FilterOperator.LessThanOrEqual:
                    return value <= target;
                default:
                    return false;
            }
        }

        private bool EvaluateStringFilter(string value, string filterValue, FilterOperator op)
        {
            if (value == null) value = string.Empty;
            if (filterValue == null) filterValue = string.Empty;
            
            switch (op)
            {
                case FilterOperator.Equals:
                    return value.Equals(filterValue, StringComparison.Ordinal);
                case FilterOperator.NotEquals:
                    return !value.Equals(filterValue, StringComparison.Ordinal);
                case FilterOperator.Contains:
                    return value.Contains(filterValue);
                case FilterOperator.StartsWith:
                    return value.StartsWith(filterValue, StringComparison.Ordinal);
                case FilterOperator.EndsWith:
                    return value.EndsWith(filterValue, StringComparison.Ordinal);
                default:
                    return false;
            }
        }

        private void Log(string message)
        {
            if (_enableLogging && _logBuilder.Length < MAX_LOG_SIZE)
            {
                _logBuilder.AppendLine($"[{DateTime.Now:HH:mm:ss.fff}] {message}");
            }
        }

        private void ResetLog(bool enableLogging)
        {
            _enableLogging = enableLogging;
            _logBuilder.Clear();
            
            if (_logBuilder.Capacity > MAX_LOG_SIZE * 2)
            {
                _logBuilder = new StringBuilder(4096);
            }
        }

        private string GetLog()
        {
            return _logBuilder.ToString();
        }

        private void CleanupAfterOperation()
        {
            if (_logBuilder.Length > MAX_LOG_SIZE / 2)
            {
                _logBuilder.Clear();
                GC.Collect(0, GCCollectionMode.Optimized);
            }
        }

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (!_disposed)
            {
                if (disposing)
                {
                    if (_logBuilder != null)
                    {
                        _logBuilder.Clear();
                        _logBuilder = null;
                    }
                }
                
                _disposed = true;
            }
        }

        private void ThrowIfDisposed()
        {
            if (_disposed)
            {
                throw new ObjectDisposedException(nameof(JsonCleanerTool));
            }
        }

        ~JsonCleanerTool()
        {
            Dispose(false);
        }
    }
}
