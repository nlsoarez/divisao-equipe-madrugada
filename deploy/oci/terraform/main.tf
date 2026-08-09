data "oci_identity_availability_domains" "available" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  shape                    = var.instance_shape
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  availability_domain = coalesce(
    var.availability_domain,
    data.oci_identity_availability_domains.available.availability_domains[0].name
  )

  common_tags = {
    project   = var.project_name
    managedBy = "terraform"
  }
}

resource "oci_core_vcn" "app" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "${var.project_name}-vcn"
  dns_label      = "divmadrugada"
  freeform_tags  = local.common_tags
}

resource "oci_core_internet_gateway" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.app.id
  display_name   = "${var.project_name}-internet-gateway"
  enabled        = true
  freeform_tags  = local.common_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.app.id
  display_name   = "${var.project_name}-public-routes"
  freeform_tags  = local.common_tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.app.id
  }
}

resource "oci_core_security_list" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.app.id
  display_name   = "${var.project_name}-security-list"
  freeform_tags  = local.common_tags

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  ingress_security_rules {
    protocol = "6"
    source   = var.ssh_ingress_cidr

    tcp_options {
      min = 22
      max = 22
    }
  }

  dynamic "ingress_security_rules" {
    for_each = toset([80, 443])
    content {
      protocol = "6"
      source   = "0.0.0.0/0"

      tcp_options {
        min = ingress_security_rules.value
        max = ingress_security_rules.value
      }
    }
  }

  ingress_security_rules {
    protocol = "17"
    source   = "0.0.0.0/0"

    udp_options {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.app.id
  cidr_block                 = "10.42.1.0/24"
  display_name               = "${var.project_name}-public-subnet"
  dns_label                  = "public"
  prohibit_public_ip_on_vnic = false
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.app.id]
  freeform_tags              = local.common_tags
}

resource "oci_core_instance" "app" {
  availability_domain  = local.availability_domain
  compartment_id       = var.compartment_ocid
  display_name         = "${var.project_name}-app"
  shape                = var.instance_shape
  preserve_boot_volume = true
  freeform_tags        = local.common_tags

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gb
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    display_name     = "${var.project_name}-vnic"
    hostname_label   = "app"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  metadata = {
    ssh_authorized_keys = var.ssh_authorized_key
    user_data           = base64encode(file("${path.module}/cloud-init.yaml"))
  }
}
