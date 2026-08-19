output "instance_id" {
  description = "OCID da VM da aplicacao."
  value       = oci_core_instance.app.id
}

output "public_ip" {
  description = "IP publico para DNS e deploy."
  value       = oci_core_instance.app.public_ip
}

output "ssh_command" {
  description = "Comando-base para acessar a VM."
  value       = "ssh ubuntu@${oci_core_instance.app.public_ip}"
}

output "temporary_url" {
  description = "URL HTTP temporaria; configure DNS/TLS antes do uso normal."
  value       = "http://${oci_core_instance.app.public_ip}"
}
