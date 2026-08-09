variable "region" {
  description = "Regiao OCI, por exemplo sa-saopaulo-1."
  type        = string
}

variable "tenancy_ocid" {
  description = "OCID da tenancy, usado para listar Availability Domains."
  type        = string
}

variable "compartment_ocid" {
  description = "OCID do compartment onde os recursos serao criados."
  type        = string
}

variable "ssh_authorized_key" {
  description = "Chave publica SSH autorizada na VM."
  type        = string
  sensitive   = true
}

variable "ssh_ingress_cidr" {
  description = "CIDR publico autorizado no SSH/22. Use seu IP com /32."
  type        = string

  validation {
    condition     = var.ssh_ingress_cidr != "0.0.0.0/0"
    error_message = "SSH nao pode ficar aberto para toda a internet; informe seu IP/32."
  }
}

variable "project_name" {
  description = "Prefixo de nomes e tags."
  type        = string
  default     = "divisao-madrugada"
}

variable "availability_domain" {
  description = "Availability Domain. Vazio usa o primeiro AD do tenancy."
  type        = string
  default     = null
  nullable    = true
}

variable "instance_shape" {
  description = "Shape flexivel da VM. A1 e ARM; a imagem e construida na propria VM."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "instance_ocpus" {
  description = "Quantidade de OCPUs."
  type        = number
  default     = 1
}

variable "instance_memory_gb" {
  description = "Memoria da VM em GB."
  type        = number
  default     = 6
}
