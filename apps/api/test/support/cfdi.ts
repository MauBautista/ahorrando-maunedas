/**
 * A synthetic CFDI 4.0 like a supermarket's (T-307): milk at a 0 % rate, cookies with a discount and 16 % VAT, a soda
 * with 16 % VAT. Sums: SubTotal 89.86, Descuento 5.17, taxes 5.71, Total 90.40; lines as paid 49.00, 24.00 and 17.40.
 */
export const CFDI = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="A" Folio="123456" Fecha="2026-10-31T14:23:11" SubTotal="89.86" Descuento="5.17" Moneda="MXN"
  Total="90.40" TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" LugarExpedicion="72000">
  <cfdi:Emisor Rfc="CME910715UB9" Nombre="COSTCO DE MEXICO" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XAXX010101000" Nombre="PUBLICO EN GENERAL" DomicilioFiscalReceptor="72000" RegimenFiscalReceptor="616" UsoCFDI="S01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="50131700" NoIdentificacion="7501020515343" Cantidad="2" ClaveUnidad="H87" Descripcion="LECHE  LALA ENTERA 1L" ValorUnitario="24.50" Importe="49.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados>
        <cfdi:Traslado Base="49.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.000000" Importe="0.00"/>
      </cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
    <cfdi:Concepto ClaveProdServ="50181900" Cantidad="1" ClaveUnidad="H87" Descripcion="GALLETAS MARIAS &amp; NATAS 500G" ValorUnitario="25.86" Importe="25.86" Descuento="5.17" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados>
        <cfdi:Traslado Base="20.69" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="3.31"/>
      </cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
    <cfdi:Concepto ClaveProdServ="50202306" NoIdentificacion=" " Cantidad="1" ClaveUnidad="H87" Descripcion="REFRESCO COLA 2L" ValorUnitario="15.00" Importe="15.00" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados>
        <cfdi:Traslado Base="15.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2.40"/>
      </cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="5.71">
    <cfdi:Traslados><cfdi:Traslado Base="84.69" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="5.71"/></cfdi:Traslados>
  </cfdi:Impuestos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="6b9f2a3c-1d4e-4f5a-8b7c-9d0e1f2a3b4c" FechaTimbrado="2026-10-31T14:25:00" RfcProvCertif="SAT970701NN3" SelloCFD="x" NoCertificadoSAT="1" SelloSAT="y"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

export const FISCAL_UUID = '6B9F2A3C-1D4E-4F5A-8B7C-9D0E1F2A3B4C';
