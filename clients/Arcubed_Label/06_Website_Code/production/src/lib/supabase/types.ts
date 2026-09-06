// AUTO-GENERATED — do not edit by hand.
//
// Generated from the live Arcubed Supabase project (ref: fnswiyxjbsabomktqizr) with:
//   supabase gen types typescript --project-id fnswiyxjbsabomktqizr > src/lib/supabase/types.ts
//
// Re-run that command after every migration.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addons: {
        Row: {
          active: boolean
          description: string | null
          id: string
          image_url: string | null
          name: string
        }
        Insert: {
          active?: boolean
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
        }
        Update: {
          active?: boolean
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
        }
        Relationships: []
      }
      colours: {
        Row: {
          active: boolean
          hex_value: string | null
          id: string
          is_two_tone: boolean
          material_ref: string | null
          name: string
          swatch_image_url: string | null
        }
        Insert: {
          active?: boolean
          hex_value?: string | null
          id?: string
          is_two_tone?: boolean
          material_ref?: string | null
          name: string
          swatch_image_url?: string | null
        }
        Update: {
          active?: boolean
          hex_value?: string | null
          id?: string
          is_two_tone?: boolean
          material_ref?: string | null
          name?: string
          swatch_image_url?: string | null
        }
        Relationships: []
      }
      model_assets: {
        Row: {
          active: boolean
          created_at: string
          format: string
          glb_url: string
          id: string
          is_placeholder: boolean
          kind: string
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          format?: string
          glb_url: string
          id?: string
          is_placeholder?: boolean
          kind: string
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          format?: string
          glb_url?: string
          id?: string
          is_placeholder?: boolean
          kind?: string
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      option_upgrade_defaults: {
        Row: {
          currency_code: string
          default_price_delta: number
          option_type: string
          updated_at: string
        }
        Insert: {
          currency_code: string
          default_price_delta: number
          option_type: string
          updated_at?: string
        }
        Update: {
          currency_code?: string
          default_price_delta?: number
          option_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          configuration_snapshot: Json
          created_at: string
          id: string
          item_kind: string
          order_id: string
          preview_snapshot: Json | null
          product_id: string | null
          product_name_snapshot: string
          quantity: number
          ready_for_delivery_item_id: string | null
          unit_price: number
        }
        Insert: {
          configuration_snapshot: Json
          created_at?: string
          id?: string
          item_kind?: string
          order_id: string
          preview_snapshot?: Json | null
          product_id?: string | null
          product_name_snapshot: string
          quantity: number
          ready_for_delivery_item_id?: string | null
          unit_price: number
        }
        Update: {
          configuration_snapshot?: Json
          created_at?: string
          id?: string
          item_kind?: string
          order_id?: string
          preview_snapshot?: Json | null
          product_id?: string | null
          product_name_snapshot?: string
          quantity?: number
          ready_for_delivery_item_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ready_for_delivery_item_id_fkey"
            columns: ["ready_for_delivery_item_id"]
            isOneToOne: false
            referencedRelation: "ready_for_delivery_items"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          confirmation_token: string
          created_at: string
          currency: string
          customer_email: string
          customer_name: string
          customer_phone: string | null
          id: string
          notes: string | null
          idempotency_key: string | null
          order_number: string
          payment_status: string
          shipping_address: Json | null
          shipping_amount: number
          shipping_quote_required: boolean
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          confirmation_token?: string
          created_at?: string
          currency?: string
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          id?: string
          notes?: string | null
          idempotency_key?: string | null
          order_number: string
          payment_status?: string
          shipping_address?: Json | null
          shipping_amount?: number
          shipping_quote_required?: boolean
          status?: string
          subtotal: number
          total: number
          updated_at?: string
        }
        Update: {
          confirmation_token?: string
          created_at?: string
          currency?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          id?: string
          notes?: string | null
          idempotency_key?: string | null
          order_number?: string
          payment_status?: string
          shipping_address?: Json | null
          shipping_amount?: number
          shipping_quote_required?: boolean
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      contact_inquiries: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          status: string
          topic: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          status?: string
          topic: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          status?: string
          topic?: string
        }
        Relationships: []
      }
      product_addons: {
        Row: {
          active: boolean
          addon_id: string
          compatible_colour_ids: string[] | null
          id: string
          price_delta: number
          product_id: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          addon_id: string
          compatible_colour_ids?: string[] | null
          id?: string
          price_delta?: number
          product_id: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          addon_id?: string
          compatible_colour_ids?: string[] | null
          id?: string
          price_delta?: number
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_addons_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_addons_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_colours: {
        Row: {
          active: boolean
          colour_id: string
          id: string
          price_delta: number
          product_id: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          colour_id: string
          id?: string
          price_delta?: number
          product_id: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          colour_id?: string
          id?: string
          price_delta?: number
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_colours_colour_id_fkey"
            columns: ["colour_id"]
            isOneToOne: false
            referencedRelation: "colours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_colours_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          colour_id: string | null
          created_at: string
          id: string
          image_type: string
          image_url: string
          product_id: string
          sort_order: number
          strap_handle_id: string | null
        }
        Insert: {
          colour_id?: string | null
          created_at?: string
          id?: string
          image_type?: string
          image_url: string
          product_id: string
          sort_order?: number
          strap_handle_id?: string | null
        }
        Update: {
          colour_id?: string | null
          created_at?: string
          id?: string
          image_type?: string
          image_url?: string
          product_id?: string
          sort_order?: number
          strap_handle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_colour_id_fkey"
            columns: ["colour_id"]
            isOneToOne: false
            referencedRelation: "colours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_strap_handle_id_fkey"
            columns: ["strap_handle_id"]
            isOneToOne: false
            referencedRelation: "straps_handles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_models: {
        Row: {
          active: boolean
          created_at: string
          id: string
          model_asset_id: string
          product_id: string
          size_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          model_asset_id: string
          product_id: string
          size_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          model_asset_id?: string
          product_id?: string
          size_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_models_model_asset_id_fkey"
            columns: ["model_asset_id"]
            isOneToOne: false
            referencedRelation: "model_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_models_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_models_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "sizes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sizes: {
        Row: {
          active: boolean
          id: string
          note: string | null
          price_delta: number
          product_id: string
          size_id: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          id?: string
          note?: string | null
          price_delta?: number
          product_id: string
          size_id: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          id?: string
          note?: string | null
          price_delta?: number
          product_id?: string
          size_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sizes_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "sizes"
            referencedColumns: ["id"]
          },
        ]
      }
      product_straps_handles: {
        Row: {
          active: boolean
          compatible_colour_ids: string[] | null
          id: string
          price_delta: number
          product_id: string
          sort_order: number
          strap_handle_id: string
        }
        Insert: {
          active?: boolean
          compatible_colour_ids?: string[] | null
          id?: string
          price_delta?: number
          product_id: string
          sort_order?: number
          strap_handle_id: string
        }
        Update: {
          active?: boolean
          compatible_colour_ids?: string[] | null
          id?: string
          price_delta?: number
          product_id?: string
          sort_order?: number
          strap_handle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_straps_handles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_straps_handles_strap_handle_id_fkey"
            columns: ["strap_handle_id"]
            isOneToOne: false
            referencedRelation: "straps_handles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          base_price: number
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      ready_for_delivery_item_images: {
        Row: {
          created_at: string
          id: string
          image_url: string
          ready_for_delivery_item_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          ready_for_delivery_item_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          ready_for_delivery_item_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ready_for_delivery_item_images_ready_for_delivery_item_id_fkey"
            columns: ["ready_for_delivery_item_id"]
            isOneToOne: false
            referencedRelation: "ready_for_delivery_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ready_for_delivery_items: {
        Row: {
          active: boolean
          chain_id: string | null
          colour_id: string | null
          configuration_description: string | null
          created_at: string
          id: string
          price: number
          product_id: string
          quantity_available: number
          ready_for_delivery: boolean
          secondary_colour_id: string | null
          size_id: string | null
          sort_order: number
          strap_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          chain_id?: string | null
          colour_id?: string | null
          configuration_description?: string | null
          created_at?: string
          id?: string
          price: number
          product_id: string
          quantity_available?: number
          ready_for_delivery?: boolean
          secondary_colour_id?: string | null
          size_id?: string | null
          sort_order?: number
          strap_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          chain_id?: string | null
          colour_id?: string | null
          configuration_description?: string | null
          created_at?: string
          id?: string
          price?: number
          product_id?: string
          quantity_available?: number
          ready_for_delivery?: boolean
          secondary_colour_id?: string | null
          size_id?: string | null
          sort_order?: number
          strap_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ready_for_delivery_items_chain_id_fkey"
            columns: ["chain_id"]
            isOneToOne: false
            referencedRelation: "straps_handles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_for_delivery_items_colour_id_fkey"
            columns: ["colour_id"]
            isOneToOne: false
            referencedRelation: "colours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_for_delivery_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_for_delivery_items_secondary_colour_id_fkey"
            columns: ["secondary_colour_id"]
            isOneToOne: false
            referencedRelation: "colours"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_for_delivery_items_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "sizes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ready_for_delivery_items_strap_id_fkey"
            columns: ["strap_id"]
            isOneToOne: false
            referencedRelation: "straps_handles"
            referencedColumns: ["id"]
          },
        ]
      }
      return_policies: {
        Row: {
          exceptions_summary: string
          is_returnable: boolean | null
          order_type: string
          policy_summary: string
          return_window_days: number | null
          updated_at: string
        }
        Insert: {
          exceptions_summary: string
          is_returnable?: boolean | null
          order_type: string
          policy_summary: string
          return_window_days?: number | null
          updated_at?: string
        }
        Update: {
          exceptions_summary?: string
          is_returnable?: boolean | null
          order_type?: string
          policy_summary?: string
          return_window_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      shipping_rules: {
        Row: {
          amount: number | null
          currency_code: string
          id: string
          is_quote_required: boolean
          label: string
          sort_order: number
          updated_at: string
          zone_key: string
        }
        Insert: {
          amount?: number | null
          currency_code: string
          id?: string
          is_quote_required?: boolean
          label: string
          sort_order?: number
          updated_at?: string
          zone_key: string
        }
        Update: {
          amount?: number | null
          currency_code?: string
          id?: string
          is_quote_required?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
          zone_key?: string
        }
        Relationships: []
      }
      sizes: {
        Row: {
          active: boolean
          description: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          currency_code: string
          id: number
          production_time_label: string
          production_time_max_days: number
          production_time_min_days: number
          ready_for_delivery_fulfillment_label: string
          updated_at: string
        }
        Insert: {
          currency_code: string
          id?: number
          production_time_label: string
          production_time_max_days: number
          production_time_min_days: number
          ready_for_delivery_fulfillment_label?: string
          updated_at?: string
        }
        Update: {
          currency_code?: string
          id?: number
          production_time_label?: string
          production_time_max_days?: number
          production_time_min_days?: number
          ready_for_delivery_fulfillment_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      straps_handles: {
        Row: {
          active: boolean
          id: string
          image_url: string | null
          model_asset_id: string | null
          name: string
          type: string
        }
        Insert: {
          active?: boolean
          id?: string
          image_url?: string | null
          model_asset_id?: string | null
          name: string
          type: string
        }
        Update: {
          active?: boolean
          id?: string
          image_url?: string | null
          model_asset_id?: string | null
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "straps_handles_model_asset_id_fkey"
            columns: ["model_asset_id"]
            isOneToOne: false
            referencedRelation: "model_assets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_ready_for_delivery_stock: {
        Args: { p_item_id: string; p_quantity: number }
        Returns: number
      }
      release_ready_for_delivery_stock: {
        Args: { p_item_id: string; p_quantity: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals["public"]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
