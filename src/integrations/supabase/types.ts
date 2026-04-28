export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          user_email: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          allowed_ips: string | null
          ativo: boolean
          created_at: string
          id: string
          key_value: string
          name: string
          scopes: Json | null
        }
        Insert: {
          allowed_ips?: string | null
          ativo?: boolean
          created_at?: string
          id?: string
          key_value: string
          name: string
          scopes?: Json | null
        }
        Update: {
          allowed_ips?: string | null
          ativo?: boolean
          created_at?: string
          id?: string
          key_value?: string
          name?: string
          scopes?: Json | null
        }
        Relationships: []
      }
      banners: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          imagem_url: string | null
          link_url: string | null
          ordem: number
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          imagem_url?: string | null
          link_url?: string | null
          ordem?: number
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          imagem_url?: string | null
          link_url?: string | null
          ordem?: number
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          logo_url: string | null
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          logo_url?: string | null
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      categorias: {
        Row: {
          ativo: boolean
          b2bwave_id: number | null
          created_at: string
          desconto: number | null
          descricao: string | null
          id: string
          imagem_url: string | null
          nome: string
          ordem: number
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          b2bwave_id?: number | null
          created_at?: string
          desconto?: number | null
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          nome: string
          ordem?: number
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          b2bwave_id?: number | null
          created_at?: string
          desconto?: number | null
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          nome?: string
          ordem?: number
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_payment_options: {
        Row: {
          cliente_id: string
          created_at: string | null
          id: string
          payment_option_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          id?: string
          payment_option_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          id?: string
          payment_option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_payment_options_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_payment_options_payment_option_id_fkey"
            columns: ["payment_option_id"]
            isOneToOne: false
            referencedRelation: "payment_options"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_privacy_groups: {
        Row: {
          cliente_id: string
          created_at: string | null
          id: string
          privacy_group_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          id?: string
          privacy_group_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          id?: string
          privacy_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_privacy_groups_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_privacy_groups_privacy_group_id_fkey"
            columns: ["privacy_group_id"]
            isOneToOne: false
            referencedRelation: "privacy_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_shipping_options: {
        Row: {
          cliente_id: string
          created_at: string | null
          id: string
          shipping_option_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string | null
          id?: string
          shipping_option_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string | null
          id?: string
          shipping_option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_shipping_options_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_shipping_options_shipping_option_id_fkey"
            columns: ["shipping_option_id"]
            isOneToOne: false
            referencedRelation: "shipping_options"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          activity: string | null
          admin_comments: string | null
          billing_same_as_contact: boolean | null
          cep: string | null
          cidade: string | null
          company_number: string | null
          created_at: string
          customer_reference_code: string | null
          disable_ordering: boolean | null
          discount: number | null
          email: string
          empresa: string
          endereco: string | null
          endereco2: string | null
          estado: string | null
          id: string
          is_active: boolean | null
          language: string | null
          minimum_order_value: number | null
          nome: string
          pais: string | null
          parent_customer_id: string | null
          representante_id: string | null
          status: Database["public"]["Enums"]["cliente_status"]
          tabela_preco_id: string | null
          tax_customer_group_id: string | null
          telefone: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          activity?: string | null
          admin_comments?: string | null
          billing_same_as_contact?: boolean | null
          cep?: string | null
          cidade?: string | null
          company_number?: string | null
          created_at?: string
          customer_reference_code?: string | null
          disable_ordering?: boolean | null
          discount?: number | null
          email: string
          empresa?: string
          endereco?: string | null
          endereco2?: string | null
          estado?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          minimum_order_value?: number | null
          nome: string
          pais?: string | null
          parent_customer_id?: string | null
          representante_id?: string | null
          status?: Database["public"]["Enums"]["cliente_status"]
          tabela_preco_id?: string | null
          tax_customer_group_id?: string | null
          telefone?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          activity?: string | null
          admin_comments?: string | null
          billing_same_as_contact?: boolean | null
          cep?: string | null
          cidade?: string | null
          company_number?: string | null
          created_at?: string
          customer_reference_code?: string | null
          disable_ordering?: boolean | null
          discount?: number | null
          email?: string
          empresa?: string
          endereco?: string | null
          endereco2?: string | null
          estado?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          minimum_order_value?: number | null
          nome?: string
          pais?: string | null
          parent_customer_id?: string | null
          representante_id?: string | null
          status?: Database["public"]["Enums"]["cliente_status"]
          tabela_preco_id?: string | null
          tax_customer_group_id?: string | null
          telefone?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_parent_customer_id_fkey"
            columns: ["parent_customer_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_representante_id_fkey"
            columns: ["representante_id"]
            isOneToOne: false
            referencedRelation: "representantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_tabela_preco_id_fkey"
            columns: ["tabela_preco_id"]
            isOneToOne: false
            referencedRelation: "tabelas_preco"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_tax_customer_group_id_fkey"
            columns: ["tax_customer_group_id"]
            isOneToOne: false
            referencedRelation: "tax_customer_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      company_activities: {
        Row: {
          created_at: string | null
          customer_name: string | null
          descricao: string | null
          id: string
          tipo: string
        }
        Insert: {
          created_at?: string | null
          customer_name?: string | null
          descricao?: string | null
          id?: string
          tipo: string
        }
        Update: {
          created_at?: string | null
          customer_name?: string | null
          descricao?: string | null
          id?: string
          tipo?: string
        }
        Relationships: []
      }
      company_contacts: {
        Row: {
          ativo: boolean
          cliente_id: string
          created_at: string
          email: string
          id: string
          nome: string
          role: string
          user_id: string | null
        }
        Insert: {
          ativo?: boolean
          cliente_id: string
          created_at?: string
          email?: string
          id?: string
          nome?: string
          role?: string
          user_id?: string | null
        }
        Update: {
          ativo?: boolean
          cliente_id?: string
          created_at?: string
          email?: string
          id?: string
          nome?: string
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_contacts_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          admin_title_homepage: string | null
          api_configuration: Json | null
          api_token: string | null
          app_code: string | null
          app_configuration: Json | null
          attach_pdf_order: boolean | null
          attach_xls_order: boolean | null
          bcc_outgoing_emails: string | null
          cases_order: string | null
          catalog_header_url: string | null
          catalog_logo_url: string | null
          contact_form_bcc: string | null
          contact_form_cc: string | null
          contact_form_email: string | null
          conversion_fb_order: string | null
          conversion_fb_reg: string | null
          conversion_google_order: string | null
          conversion_google_reg: string | null
          conversion_tracking: string | null
          cookie_policy_banner: string | null
          cookie_policy_content: string | null
          cor_primaria: string | null
          cor_secundaria: string | null
          created_at: string
          custom_code: string | null
          custom_code_admin: string | null
          custom_code_admin_body_close: string | null
          custom_code_admin_body_open: string | null
          custom_code_body_close: string | null
          custom_code_body_open: string | null
          custom_code_head: string | null
          custom_css: string | null
          custom_css_admin: string | null
          default_product_image: string | null
          email_api_key: string | null
          email_contato: string | null
          email_from: string | null
          email_new_customer: string | null
          email_new_orders: string | null
          email_on_approval: boolean | null
          email_on_new_order: boolean | null
          email_on_new_registration: boolean | null
          email_on_order_status: boolean | null
          email_on_rejection: boolean | null
          email_order_messages: string | null
          email_provider: string | null
          email_reply_to: string | null
          email_signature: string | null
          enable_invoice: boolean | null
          enable_scope: boolean | null
          enable_secure_login: boolean | null
          enable_support_button: boolean | null
          endereco: string | null
          facebook_url: string | null
          featured_categories: string | null
          footer_logo_url: string | null
          fuso_horario: string
          global_notification: string | null
          global_notification_content: string | null
          global_notification_type: string | null
          google_analytics_code: string | null
          grid_list_default: string | null
          id: string
          instagram_url: string | null
          item_ordering: string | null
          linkedin_url: string | null
          logo_url: string | null
          mensagem_boas_vindas: string | null
          meta_title_homepage: string | null
          mobile_allow_all_customers: boolean | null
          mobile_allow_edit_prices: boolean | null
          mobile_app_enabled: boolean | null
          moeda: string
          nome_empresa: string
          pedido_minimo: number
          permite_cadastro_aberto: boolean
          pinterest_url: string | null
          politica_privacidade: string | null
          quickbooks_enabled: boolean | null
          registration_fields: Json | null
          segments: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: string | null
          smtp_username: string | null
          telefone_contato: string | null
          termos_condicoes: string | null
          theme: string | null
          twitter_url: string | null
          updated_at: string
          warehouse_inactivity_default: number | null
          warehouse_inactivity_popup: number | null
          warehouse_popup_day: number | null
          warehouse_popup_enabled: boolean | null
          warehouse_popup_message: string | null
          webhook_auth_header: string | null
          webhook_create_order: string | null
          webhook_update_order: string | null
          youtube_url: string | null
          zapier_password: string | null
          zapier_username: string | null
        }
        Insert: {
          admin_title_homepage?: string | null
          api_configuration?: Json | null
          api_token?: string | null
          app_code?: string | null
          app_configuration?: Json | null
          attach_pdf_order?: boolean | null
          attach_xls_order?: boolean | null
          bcc_outgoing_emails?: string | null
          cases_order?: string | null
          catalog_header_url?: string | null
          catalog_logo_url?: string | null
          contact_form_bcc?: string | null
          contact_form_cc?: string | null
          contact_form_email?: string | null
          conversion_fb_order?: string | null
          conversion_fb_reg?: string | null
          conversion_google_order?: string | null
          conversion_google_reg?: string | null
          conversion_tracking?: string | null
          cookie_policy_banner?: string | null
          cookie_policy_content?: string | null
          cor_primaria?: string | null
          cor_secundaria?: string | null
          created_at?: string
          custom_code?: string | null
          custom_code_admin?: string | null
          custom_code_admin_body_close?: string | null
          custom_code_admin_body_open?: string | null
          custom_code_body_close?: string | null
          custom_code_body_open?: string | null
          custom_code_head?: string | null
          custom_css?: string | null
          custom_css_admin?: string | null
          default_product_image?: string | null
          email_api_key?: string | null
          email_contato?: string | null
          email_from?: string | null
          email_new_customer?: string | null
          email_new_orders?: string | null
          email_on_approval?: boolean | null
          email_on_new_order?: boolean | null
          email_on_new_registration?: boolean | null
          email_on_order_status?: boolean | null
          email_on_rejection?: boolean | null
          email_order_messages?: string | null
          email_provider?: string | null
          email_reply_to?: string | null
          email_signature?: string | null
          enable_invoice?: boolean | null
          enable_scope?: boolean | null
          enable_secure_login?: boolean | null
          enable_support_button?: boolean | null
          endereco?: string | null
          facebook_url?: string | null
          featured_categories?: string | null
          footer_logo_url?: string | null
          fuso_horario?: string
          global_notification?: string | null
          global_notification_content?: string | null
          global_notification_type?: string | null
          google_analytics_code?: string | null
          grid_list_default?: string | null
          id?: string
          instagram_url?: string | null
          item_ordering?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          mensagem_boas_vindas?: string | null
          meta_title_homepage?: string | null
          mobile_allow_all_customers?: boolean | null
          mobile_allow_edit_prices?: boolean | null
          mobile_app_enabled?: boolean | null
          moeda?: string
          nome_empresa?: string
          pedido_minimo?: number
          permite_cadastro_aberto?: boolean
          pinterest_url?: string | null
          politica_privacidade?: string | null
          quickbooks_enabled?: boolean | null
          registration_fields?: Json | null
          segments?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: string | null
          smtp_username?: string | null
          telefone_contato?: string | null
          termos_condicoes?: string | null
          theme?: string | null
          twitter_url?: string | null
          updated_at?: string
          warehouse_inactivity_default?: number | null
          warehouse_inactivity_popup?: number | null
          warehouse_popup_day?: number | null
          warehouse_popup_enabled?: boolean | null
          warehouse_popup_message?: string | null
          webhook_auth_header?: string | null
          webhook_create_order?: string | null
          webhook_update_order?: string | null
          youtube_url?: string | null
          zapier_password?: string | null
          zapier_username?: string | null
        }
        Update: {
          admin_title_homepage?: string | null
          api_configuration?: Json | null
          api_token?: string | null
          app_code?: string | null
          app_configuration?: Json | null
          attach_pdf_order?: boolean | null
          attach_xls_order?: boolean | null
          bcc_outgoing_emails?: string | null
          cases_order?: string | null
          catalog_header_url?: string | null
          catalog_logo_url?: string | null
          contact_form_bcc?: string | null
          contact_form_cc?: string | null
          contact_form_email?: string | null
          conversion_fb_order?: string | null
          conversion_fb_reg?: string | null
          conversion_google_order?: string | null
          conversion_google_reg?: string | null
          conversion_tracking?: string | null
          cookie_policy_banner?: string | null
          cookie_policy_content?: string | null
          cor_primaria?: string | null
          cor_secundaria?: string | null
          created_at?: string
          custom_code?: string | null
          custom_code_admin?: string | null
          custom_code_admin_body_close?: string | null
          custom_code_admin_body_open?: string | null
          custom_code_body_close?: string | null
          custom_code_body_open?: string | null
          custom_code_head?: string | null
          custom_css?: string | null
          custom_css_admin?: string | null
          default_product_image?: string | null
          email_api_key?: string | null
          email_contato?: string | null
          email_from?: string | null
          email_new_customer?: string | null
          email_new_orders?: string | null
          email_on_approval?: boolean | null
          email_on_new_order?: boolean | null
          email_on_new_registration?: boolean | null
          email_on_order_status?: boolean | null
          email_on_rejection?: boolean | null
          email_order_messages?: string | null
          email_provider?: string | null
          email_reply_to?: string | null
          email_signature?: string | null
          enable_invoice?: boolean | null
          enable_scope?: boolean | null
          enable_secure_login?: boolean | null
          enable_support_button?: boolean | null
          endereco?: string | null
          facebook_url?: string | null
          featured_categories?: string | null
          footer_logo_url?: string | null
          fuso_horario?: string
          global_notification?: string | null
          global_notification_content?: string | null
          global_notification_type?: string | null
          google_analytics_code?: string | null
          grid_list_default?: string | null
          id?: string
          instagram_url?: string | null
          item_ordering?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          mensagem_boas_vindas?: string | null
          meta_title_homepage?: string | null
          mobile_allow_all_customers?: boolean | null
          mobile_allow_edit_prices?: boolean | null
          mobile_app_enabled?: boolean | null
          moeda?: string
          nome_empresa?: string
          pedido_minimo?: number
          permite_cadastro_aberto?: boolean
          pinterest_url?: string | null
          politica_privacidade?: string | null
          quickbooks_enabled?: boolean | null
          registration_fields?: Json | null
          segments?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: string | null
          smtp_username?: string | null
          telefone_contato?: string | null
          termos_condicoes?: string | null
          theme?: string | null
          twitter_url?: string | null
          updated_at?: string
          warehouse_inactivity_default?: number | null
          warehouse_inactivity_popup?: number | null
          warehouse_popup_day?: number | null
          warehouse_popup_enabled?: boolean | null
          warehouse_popup_message?: string | null
          webhook_auth_header?: string | null
          webhook_create_order?: string | null
          webhook_update_order?: string | null
          youtube_url?: string | null
          zapier_password?: string | null
          zapier_username?: string | null
        }
        Relationships: []
      }
      coupons: {
        Row: {
          ativo: boolean | null
          codigo: string
          created_at: string | null
          data_fim: string | null
          data_inicio: string | null
          id: string
          tipo: string
          uso_atual: number | null
          uso_maximo: number | null
          valor: number
        }
        Insert: {
          ativo?: boolean | null
          codigo: string
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          tipo?: string
          uso_atual?: number | null
          uso_maximo?: number | null
          valor?: number
        }
        Update: {
          ativo?: boolean | null
          codigo?: string
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          tipo?: string
          uso_atual?: number | null
          uso_maximo?: number | null
          valor?: number
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          assunto: string
          ativo: boolean | null
          corpo: string
          created_at: string | null
          id: string
          nome: string
          tipo: string
          updated_at: string | null
        }
        Insert: {
          assunto: string
          ativo?: boolean | null
          corpo: string
          created_at?: string | null
          id?: string
          nome: string
          tipo?: string
          updated_at?: string | null
        }
        Update: {
          assunto?: string
          ativo?: boolean | null
          corpo?: string
          created_at?: string | null
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      enderecos: {
        Row: {
          bairro: string | null
          cep: string
          cidade: string
          cliente_id: string
          complemento: string | null
          created_at: string
          estado: string
          id: string
          logradouro: string
          numero: string | null
          principal: boolean | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep: string
          cidade: string
          cliente_id: string
          complemento?: string | null
          created_at?: string
          estado: string
          id?: string
          logradouro: string
          numero?: string | null
          principal?: boolean | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string
          cidade?: string
          cliente_id?: string
          complemento?: string | null
          created_at?: string
          estado?: string
          id?: string
          logradouro?: string
          numero?: string | null
          principal?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enderecos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_log: {
        Row: {
          created_at: string
          id: string
          motivo: string | null
          produto_id: string
          quantidade_anterior: number
          quantidade_nova: number
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          motivo?: string | null
          produto_id: string
          quantidade_anterior: number
          quantidade_nova: number
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          motivo?: string | null
          produto_id?: string
          quantidade_anterior?: number
          quantidade_nova?: number
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_log_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      export_logs: {
        Row: {
          arquivo_url: string | null
          created_at: string | null
          id: string
          registros: number | null
          status: string | null
          tipo: string
        }
        Insert: {
          arquivo_url?: string | null
          created_at?: string | null
          id?: string
          registros?: number | null
          status?: string | null
          tipo: string
        }
        Update: {
          arquivo_url?: string | null
          created_at?: string | null
          id?: string
          registros?: number | null
          status?: string | null
          tipo?: string
        }
        Relationships: []
      }
      extra_fields: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          entidade: string
          id: string
          nome: string
          obrigatorio: boolean | null
          opcoes: Json | null
          ordem: number | null
          show_to_customers: boolean | null
          tipo: string
          view_location: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          entidade?: string
          id?: string
          nome: string
          obrigatorio?: boolean | null
          opcoes?: Json | null
          ordem?: number | null
          show_to_customers?: boolean | null
          tipo?: string
          view_location?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          entidade?: string
          id?: string
          nome?: string
          obrigatorio?: boolean | null
          opcoes?: Json | null
          ordem?: number | null
          show_to_customers?: boolean | null
          tipo?: string
          view_location?: string | null
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          arquivo_nome: string | null
          created_at: string | null
          detalhes: Json | null
          id: string
          registros_erro: number | null
          registros_sucesso: number | null
          registros_total: number | null
          status: string | null
          tipo: string
        }
        Insert: {
          arquivo_nome?: string | null
          created_at?: string | null
          detalhes?: Json | null
          id?: string
          registros_erro?: number | null
          registros_sucesso?: number | null
          registros_total?: number | null
          status?: string | null
          tipo: string
        }
        Update: {
          arquivo_nome?: string | null
          created_at?: string | null
          detalhes?: Json | null
          id?: string
          registros_erro?: number | null
          registros_sucesso?: number | null
          registros_total?: number | null
          status?: string | null
          tipo?: string
        }
        Relationships: []
      }
      measurement_units: {
        Row: {
          abreviacao: string
          ativo: boolean | null
          created_at: string | null
          id: string
          nome: string
        }
        Insert: {
          abreviacao: string
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome: string
        }
        Update: {
          abreviacao?: string
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      noticias: {
        Row: {
          ativo: boolean
          conteudo: string | null
          created_at: string
          destaque: boolean
          id: string
          imagem_url: string | null
          publicado_em: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          conteudo?: string | null
          created_at?: string
          destaque?: boolean
          id?: string
          imagem_url?: string | null
          publicado_em?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          conteudo?: string | null
          created_at?: string
          destaque?: boolean
          id?: string
          imagem_url?: string | null
          publicado_em?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_applications: {
        Row: {
          ativo: boolean
          client_id: string
          client_secret: string
          confidential: boolean | null
          created_at: string | null
          enforce: boolean | null
          id: string
          logout_url: string | null
          nome: string
          redirect_uri: string | null
          scopes: string | null
          skip_authorization: boolean | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean
          client_id?: string
          client_secret?: string
          confidential?: boolean | null
          created_at?: string | null
          enforce?: boolean | null
          id?: string
          logout_url?: string | null
          nome: string
          redirect_uri?: string | null
          scopes?: string | null
          skip_authorization?: boolean | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean
          client_id?: string
          client_secret?: string
          confidential?: boolean | null
          created_at?: string | null
          enforce?: boolean | null
          id?: string
          logout_url?: string | null
          nome?: string
          redirect_uri?: string | null
          scopes?: string | null
          skip_authorization?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      option_values: {
        Row: {
          ativo: boolean | null
          codigo: string | null
          cor: string | null
          created_at: string
          id: string
          imagem_url: string | null
          option_id: string
          ordem: number
          padrao: boolean | null
          valor: string
        }
        Insert: {
          ativo?: boolean | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          id?: string
          imagem_url?: string | null
          option_id: string
          ordem?: number
          padrao?: boolean | null
          valor: string
        }
        Update: {
          ativo?: boolean | null
          codigo?: string | null
          cor?: string | null
          created_at?: string
          id?: string
          imagem_url?: string | null
          option_id?: string
          ordem?: number
          padrao?: boolean | null
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "option_values_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
        ]
      }
      paginas: {
        Row: {
          ativo: boolean
          conteudo: string | null
          created_at: string
          id: string
          slug: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          conteudo?: string | null
          created_at?: string
          id?: string
          slug: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          conteudo?: string | null
          created_at?: string
          id?: string
          slug?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_options: {
        Row: {
          ativo: boolean | null
          cobrar_checkout: boolean | null
          created_at: string | null
          descricao: string | null
          due_in_days: number | null
          gateway_config: Json | null
          gateway_type: string | null
          id: string
          instrucoes: string | null
          nome: string
          ordem: number | null
          privado: boolean | null
          taxa_percentual: number | null
          taxa_valor: number | null
        }
        Insert: {
          ativo?: boolean | null
          cobrar_checkout?: boolean | null
          created_at?: string | null
          descricao?: string | null
          due_in_days?: number | null
          gateway_config?: Json | null
          gateway_type?: string | null
          id?: string
          instrucoes?: string | null
          nome: string
          ordem?: number | null
          privado?: boolean | null
          taxa_percentual?: number | null
          taxa_valor?: number | null
        }
        Update: {
          ativo?: boolean | null
          cobrar_checkout?: boolean | null
          created_at?: string | null
          descricao?: string | null
          due_in_days?: number | null
          gateway_config?: Json | null
          gateway_type?: string | null
          id?: string
          instrucoes?: string | null
          nome?: string
          ordem?: number | null
          privado?: boolean | null
          taxa_percentual?: number | null
          taxa_valor?: number | null
        }
        Relationships: []
      }
      pedido_itens: {
        Row: {
          created_at: string
          id: string
          nome_produto: string
          pedido_id: string
          preco_unitario: number
          produto_id: string
          quantidade: number
          sku: string
          subtotal: number
        }
        Insert: {
          created_at?: string
          id?: string
          nome_produto: string
          pedido_id: string
          preco_unitario?: number
          produto_id: string
          quantidade?: number
          sku: string
          subtotal?: number
        }
        Update: {
          created_at?: string
          id?: string
          nome_produto?: string
          pedido_id?: string
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          sku?: string
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedido_itens_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          admin_notes: string | null
          cliente_id: string
          created_at: string
          delivery_date: string | null
          delivery_mode: string | null
          endereco_entrega_id: string | null
          id: string
          is_paid: boolean | null
          numero: number
          observacoes: string | null
          payment_option_id: string | null
          po_number: string | null
          quantidade_total: number | null
          shipping_costs: number | null
          shipping_option_id: string | null
          status: Database["public"]["Enums"]["pedido_status"]
          subtotal: number
          total: number
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          cliente_id: string
          created_at?: string
          delivery_date?: string | null
          delivery_mode?: string | null
          endereco_entrega_id?: string | null
          id?: string
          is_paid?: boolean | null
          numero?: number
          observacoes?: string | null
          payment_option_id?: string | null
          po_number?: string | null
          quantidade_total?: number | null
          shipping_costs?: number | null
          shipping_option_id?: string | null
          status?: Database["public"]["Enums"]["pedido_status"]
          subtotal?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          cliente_id?: string
          created_at?: string
          delivery_date?: string | null
          delivery_mode?: string | null
          endereco_entrega_id?: string | null
          id?: string
          is_paid?: boolean | null
          numero?: number
          observacoes?: string | null
          payment_option_id?: string | null
          po_number?: string | null
          quantidade_total?: number | null
          shipping_costs?: number | null
          shipping_option_id?: string | null
          status?: Database["public"]["Enums"]["pedido_status"]
          subtotal?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_endereco_entrega_id_fkey"
            columns: ["endereco_entrega_id"]
            isOneToOne: false
            referencedRelation: "enderecos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_payment_option_id_fkey"
            columns: ["payment_option_id"]
            isOneToOne: false
            referencedRelation: "payment_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_shipping_option_id_fkey"
            columns: ["shipping_option_id"]
            isOneToOne: false
            referencedRelation: "shipping_options"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_groups: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          default_for_new_customers: boolean | null
          descricao: string | null
          id: string
          nome: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          default_for_new_customers?: boolean | null
          descricao?: string | null
          id?: string
          nome: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          default_for_new_customers?: boolean | null
          descricao?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      product_options: {
        Row: {
          ativo: boolean
          codigo: string | null
          created_at: string
          id: string
          max_items: number | null
          nome: string
          obrigatorio: boolean
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo?: string | null
          created_at?: string
          id?: string
          max_items?: number | null
          nome: string
          obrigatorio?: boolean
          tipo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string | null
          created_at?: string
          id?: string
          max_items?: number | null
          nome?: string
          obrigatorio?: boolean
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_statuses: {
        Row: {
          ativo: boolean | null
          cor: string | null
          created_at: string | null
          id: string
          nome: string
          ordem: number | null
          permite_comprar: boolean | null
          permite_visualizar: boolean | null
        }
        Insert: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string | null
          id?: string
          nome: string
          ordem?: number | null
          permite_comprar?: boolean | null
          permite_visualizar?: boolean | null
        }
        Update: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          permite_comprar?: boolean | null
          permite_visualizar?: boolean | null
        }
        Relationships: []
      }
      produto_acesso: {
        Row: {
          created_at: string | null
          grupo_nome: string
          id: string
          produto_id: string
        }
        Insert: {
          created_at?: string | null
          grupo_nome: string
          id?: string
          produto_id: string
        }
        Update: {
          created_at?: string | null
          grupo_nome?: string
          id?: string
          produto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_acesso_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_arquivos: {
        Row: {
          arquivo_url: string
          created_at: string | null
          id: string
          produto_id: string
          titulo: string
        }
        Insert: {
          arquivo_url: string
          created_at?: string | null
          id?: string
          produto_id: string
          titulo: string
        }
        Update: {
          arquivo_url?: string
          created_at?: string | null
          id?: string
          produto_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_arquivos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_descontos: {
        Row: {
          created_at: string | null
          data_fim: string | null
          data_inicio: string | null
          id: string
          percentual: number | null
          preco_final: number | null
          produto_id: string
          quantidade_minima: number | null
          tabela_preco_id: string
        }
        Insert: {
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          percentual?: number | null
          preco_final?: number | null
          produto_id: string
          quantidade_minima?: number | null
          tabela_preco_id: string
        }
        Update: {
          created_at?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          percentual?: number | null
          preco_final?: number | null
          produto_id?: string
          quantidade_minima?: number | null
          tabela_preco_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_descontos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_descontos_tabela_preco_id_fkey"
            columns: ["tabela_preco_id"]
            isOneToOne: false
            referencedRelation: "tabelas_preco"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_imagens: {
        Row: {
          created_at: string | null
          id: string
          imagem_url: string
          ordem: number | null
          produto_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          imagem_url: string
          ordem?: number | null
          produto_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          imagem_url?: string
          ordem?: number | null
          produto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_imagens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_opcoes: {
        Row: {
          created_at: string | null
          id: string
          option_id: string
          produto_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          option_id: string
          produto_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          option_id?: string
          produto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_opcoes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_opcoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_precos_cliente: {
        Row: {
          aplicar_descontos_extras: boolean | null
          cliente_id: string
          created_at: string | null
          id: string
          preco: number
          produto_id: string
        }
        Insert: {
          aplicar_descontos_extras?: boolean | null
          cliente_id: string
          created_at?: string | null
          id?: string
          preco?: number
          produto_id: string
        }
        Update: {
          aplicar_descontos_extras?: boolean | null
          cliente_id?: string
          created_at?: string | null
          id?: string
          preco?: number
          produto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_precos_cliente_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_precos_cliente_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_status_regras: {
        Row: {
          created_at: string | null
          id: string
          produto_id: string
          regra_tipo: string
          status_nome: string
          valor_limite: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          produto_id: string
          regra_tipo?: string
          status_nome: string
          valor_limite?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          produto_id?: string
          regra_tipo?: string
          status_nome?: string
          valor_limite?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "produto_status_regras_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_variantes: {
        Row: {
          ativo: boolean | null
          codigo: string
          created_at: string | null
          id: string
          imagem_url: string | null
          produto_id: string
          quantidade: number | null
          updated_at: string | null
          valores_opcao: Json | null
        }
        Insert: {
          ativo?: boolean | null
          codigo: string
          created_at?: string | null
          id?: string
          imagem_url?: string | null
          produto_id: string
          quantidade?: number | null
          updated_at?: string | null
          valores_opcao?: Json | null
        }
        Update: {
          ativo?: boolean | null
          codigo?: string
          created_at?: string | null
          id?: string
          imagem_url?: string | null
          produto_id?: string
          quantidade?: number | null
          updated_at?: string | null
          valores_opcao?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "produto_variantes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          altura: number | null
          ativo: boolean
          barcode: string | null
          brand_id: string | null
          categoria_id: string | null
          codigo_referencia: string | null
          codigo_upc: string | null
          comprimento: number | null
          created_at: string
          custo: number | null
          data_disponibilidade: string | null
          descricao: string | null
          descricao_pdf: string | null
          estoque_reservado: number
          estoque_total: number
          id: string
          imagem_url: string | null
          largura: number | null
          meta_descricao: string | null
          mostrar_ofertas: string | null
          nome: string
          permitir_backorder: boolean | null
          peso: number | null
          preco: number
          preco_msrp: number | null
          promover_categoria: boolean | null
          promover_destaque: boolean | null
          quantidade_caixa: number | null
          quantidade_maxima: number | null
          quantidade_minima: number
          quantidade_pacote: number | null
          rastrear_estoque: boolean | null
          sku: string
          status_produto: string | null
          tag_line: string | null
          unidade_medida_id: string | null
          unidade_venda: string
          updated_at: string
        }
        Insert: {
          altura?: number | null
          ativo?: boolean
          barcode?: string | null
          brand_id?: string | null
          categoria_id?: string | null
          codigo_referencia?: string | null
          codigo_upc?: string | null
          comprimento?: number | null
          created_at?: string
          custo?: number | null
          data_disponibilidade?: string | null
          descricao?: string | null
          descricao_pdf?: string | null
          estoque_reservado?: number
          estoque_total?: number
          id?: string
          imagem_url?: string | null
          largura?: number | null
          meta_descricao?: string | null
          mostrar_ofertas?: string | null
          nome: string
          permitir_backorder?: boolean | null
          peso?: number | null
          preco?: number
          preco_msrp?: number | null
          promover_categoria?: boolean | null
          promover_destaque?: boolean | null
          quantidade_caixa?: number | null
          quantidade_maxima?: number | null
          quantidade_minima?: number
          quantidade_pacote?: number | null
          rastrear_estoque?: boolean | null
          sku: string
          status_produto?: string | null
          tag_line?: string | null
          unidade_medida_id?: string | null
          unidade_venda?: string
          updated_at?: string
        }
        Update: {
          altura?: number | null
          ativo?: boolean
          barcode?: string | null
          brand_id?: string | null
          categoria_id?: string | null
          codigo_referencia?: string | null
          codigo_upc?: string | null
          comprimento?: number | null
          created_at?: string
          custo?: number | null
          data_disponibilidade?: string | null
          descricao?: string | null
          descricao_pdf?: string | null
          estoque_reservado?: number
          estoque_total?: number
          id?: string
          imagem_url?: string | null
          largura?: number | null
          meta_descricao?: string | null
          mostrar_ofertas?: string | null
          nome?: string
          permitir_backorder?: boolean | null
          peso?: number | null
          preco?: number
          preco_msrp?: number | null
          promover_categoria?: boolean | null
          promover_destaque?: boolean | null
          quantidade_caixa?: number | null
          quantidade_maxima?: number | null
          quantidade_minima?: number
          quantidade_pacote?: number | null
          rastrear_estoque?: boolean | null
          sku?: string
          status_produto?: string | null
          tag_line?: string | null
          unidade_medida_id?: string | null
          unidade_venda?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_unidade_medida_id_fkey"
            columns: ["unidade_medida_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos_relacionados: {
        Row: {
          comprar_junto: boolean | null
          created_at: string | null
          id: string
          produto_id: string
          produto_relacionado_id: string
        }
        Insert: {
          comprar_junto?: boolean | null
          created_at?: string | null
          id?: string
          produto_id: string
          produto_relacionado_id: string
        }
        Update: {
          comprar_junto?: boolean | null
          created_at?: string | null
          id?: string
          produto_id?: string
          produto_relacionado_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_relacionados_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_relacionados_produto_relacionado_id_fkey"
            columns: ["produto_relacionado_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quick_links: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          icone: string | null
          id: string
          ordem: number | null
          titulo: string
          url: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          icone?: string | null
          id?: string
          ordem?: number | null
          titulo: string
          url: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          icone?: string | null
          id?: string
          ordem?: number | null
          titulo?: string
          url?: string
        }
        Relationships: []
      }
      representantes: {
        Row: {
          ativo: boolean
          comissao_percentual: number
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ativo?: boolean
          comissao_percentual?: number
          created_at?: string
          email: string
          id?: string
          nome: string
          telefone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ativo?: boolean
          comissao_percentual?: number
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      shipping_options: {
        Row: {
          ativo: boolean | null
          condicoes: Json | null
          created_at: string | null
          descricao: string | null
          gratis_acima_de: number | null
          id: string
          nome: string
          ordem: number | null
          padrao: boolean | null
          preco: number | null
          privado: boolean | null
          tax_class_id: string | null
          tipo_regra: string | null
        }
        Insert: {
          ativo?: boolean | null
          condicoes?: Json | null
          created_at?: string | null
          descricao?: string | null
          gratis_acima_de?: number | null
          id?: string
          nome: string
          ordem?: number | null
          padrao?: boolean | null
          preco?: number | null
          privado?: boolean | null
          tax_class_id?: string | null
          tipo_regra?: string | null
        }
        Update: {
          ativo?: boolean | null
          condicoes?: Json | null
          created_at?: string | null
          descricao?: string | null
          gratis_acima_de?: number | null
          id?: string
          nome?: string
          ordem?: number | null
          padrao?: boolean | null
          preco?: number | null
          privado?: boolean | null
          tax_class_id?: string | null
          tipo_regra?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_options_tax_class_id_fkey"
            columns: ["tax_class_id"]
            isOneToOne: false
            referencedRelation: "tax_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      tabela_preco_itens: {
        Row: {
          created_at: string
          id: string
          preco: number
          produto_id: string
          tabela_preco_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preco?: number
          produto_id: string
          tabela_preco_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preco?: number
          produto_id?: string
          tabela_preco_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tabela_preco_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabela_preco_itens_tabela_preco_id_fkey"
            columns: ["tabela_preco_id"]
            isOneToOne: false
            referencedRelation: "tabelas_preco"
            referencedColumns: ["id"]
          },
        ]
      }
      tabelas_preco: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          is_default: boolean
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          is_default?: boolean
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          is_default?: boolean
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_classes: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          descricao: string | null
          id: string
          is_default: boolean | null
          nome: string
          ordem: number | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          is_default?: boolean | null
          nome: string
          ordem?: number | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          descricao?: string | null
          id?: string
          is_default?: boolean | null
          nome?: string
          ordem?: number | null
        }
        Relationships: []
      }
      tax_customer_groups: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          nome: string
          ordem: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          nome: string
          ordem?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          nome?: string
          ordem?: number | null
        }
        Relationships: []
      }
      tax_rates: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          estado: string | null
          id: string
          nome: string | null
          ordem: number | null
          percentual: number
          regiao: string
          tax_class_id: string
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          estado?: string | null
          id?: string
          nome?: string | null
          ordem?: number | null
          percentual?: number
          regiao: string
          tax_class_id: string
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          estado?: string | null
          id?: string
          nome?: string | null
          ordem?: number | null
          percentual?: number
          regiao?: string
          tax_class_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_tax_class_id_fkey"
            columns: ["tax_class_id"]
            isOneToOne: false
            referencedRelation: "tax_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rules: {
        Row: {
          created_at: string | null
          id: string
          tax_class_id: string
          tax_customer_group_id: string
          tax_rate_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          tax_class_id: string
          tax_customer_group_id: string
          tax_rate_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          tax_class_id?: string
          tax_customer_group_id?: string
          tax_rate_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rules_tax_class_id_fkey"
            columns: ["tax_class_id"]
            isOneToOne: false
            referencedRelation: "tax_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rules_tax_customer_group_id_fkey"
            columns: ["tax_customer_group_id"]
            isOneToOne: false
            referencedRelation: "tax_customer_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rules_tax_rate_id_fkey"
            columns: ["tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          permissions: Json | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          permissions?: Json | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          permissions?: Json | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      variante_precos: {
        Row: {
          created_at: string | null
          id: string
          preco: number
          tabela_preco_id: string
          variante_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          preco?: number
          tabela_preco_id: string
          variante_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          preco?: number
          tabela_preco_id?: string
          variante_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variante_precos_tabela_preco_id_fkey"
            columns: ["tabela_preco_id"]
            isOneToOne: false
            referencedRelation: "tabelas_preco"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variante_precos_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "produto_variantes"
            referencedColumns: ["id"]
          },
        ]
      }
      view_as_tokens: {
        Row: {
          admin_user_id: string
          created_at: string
          customer_id: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          customer_id: string
          expires_at?: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "view_as_tokens_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_view_as_token: {
        Args: { _token: string }
        Returns: {
          email: string
          empresa: string
          id: string
          nome: string
          tabela_preco_id: string
          user_id: string
        }[]
      }
      create_view_as_token: { Args: { _customer_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "cliente" | "warehouse" | "manager"
      cliente_status: "ativo" | "inativo" | "pendente"
      pedido_status:
        | "recebido"
        | "em_processamento"
        | "enviado"
        | "concluido"
        | "cancelado"
        | "submitted"
        | "ready_for_pickup"
        | "partial"
        | "on_hold"
        | "sent"
        | "complete"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "cliente", "warehouse", "manager"],
      cliente_status: ["ativo", "inativo", "pendente"],
      pedido_status: [
        "recebido",
        "em_processamento",
        "enviado",
        "concluido",
        "cancelado",
        "submitted",
        "ready_for_pickup",
        "partial",
        "on_hold",
        "sent",
        "complete",
        "cancelled",
      ],
    },
  },
} as const
